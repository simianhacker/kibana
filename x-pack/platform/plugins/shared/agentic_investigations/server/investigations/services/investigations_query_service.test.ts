/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServerMock } from '@kbn/core-http-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import {
  DEFAULT_CONVERSATION_TITLE,
  type ConversationWithoutRoundsWithPermissions,
} from '@kbn/agent-builder-common';
import type { ConversationPublicClient } from '@kbn/agent-builder-server';
import { toKqlExpression, type KueryNode } from '@kbn/es-query';
import type { ProposalsPluginStart } from '@kbn/proposals-plugin/server';
import type { Impact } from '../../../common/impact/impact';
import type { InvestigationHypotheses } from '../../../common/hypotheses/hypotheses';
import {
  listInvestigationsQuerySchema,
  type ListInvestigationsQueryInput,
} from '../../../common/investigations/investigation';
import type { InvestigationSubject } from '../../../common/subjects/subject';
import { WrongTemplateError } from '../../assignments/errors';
import type { HypothesesService } from '../../hypotheses/services/hypotheses_service';
import type { ImpactService } from '../../impact/services/impact_service';
import { createInMemoryStorage } from '../../investigation_attachments/in_memory_storage.mock';
import { TRANSIENT_SEARCH_RETRY_DELAYS_MS } from '../../investigation_attachments/search_with_transient_retry';
import { subjectAttachment } from '../../subjects/attachments';
import { SubjectClaimsService } from '../../subjects/services/subject_claims_service';
import { subjectDocumentId, SubjectsService } from '../../subjects/services/subjects_service';
import type { SubjectClaimDocument, SubjectDocument } from '../../subjects/storage/subject_storage';
import type { InProgressResolver } from './in_progress';
import { InvestigationsQueryService } from './investigations_query_service';
import type { InvestigationSearchScope } from './investigations_search';

const request = httpServerMock.createKibanaRequest();
const SPACE_ID = 'default';

const conversation = (
  id: string,
  overrides: Partial<ConversationWithoutRoundsWithPermissions> = {}
): ConversationWithoutRoundsWithPermissions =>
  ({
    id,
    title: `Investigation ${id}`,
    agent_id: 'agent-1',
    template_id: 'investigation',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    metadata: { status: 'open' },
    attachments: [],
    permissions: { rename: true, delete: true, update_access_control: true },
    ...overrides,
  } as ConversationWithoutRoundsWithPermissions);

const subject = (
  conversationId: string,
  subjectId: string,
  overrides: Partial<InvestigationSubject> = {}
): InvestigationSubject => ({
  id: `doc-${conversationId}-${subjectId}`,
  spaceId: SPACE_ID,
  conversationId,
  subjectType: 'alert',
  subjectId,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const impact = (conversationId: string, overrides: Partial<Impact> = {}): Impact => ({
  id: `impact-${conversationId}`,
  spaceId: SPACE_ID,
  conversationId,
  summary: 'Checkout is down',
  entities: [{ id: 'checkout', name: 'checkout', featureId: 'f-1' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const parseQuery = (query: ListInvestigationsQueryInput = {}) =>
  listInvestigationsQuerySchema.parse(query);

/**
 * Stands in for the Elasticsearch search: `matches` are the investigations its filters match, in
 * its sort order. It applies only the id scope, like the ES|QL `ids` filter.
 */
const fakeSearch = (matches: ConversationWithoutRoundsWithPermissions[]) => {
  const inScope = ({ ids, excludeIds }: InvestigationSearchScope) =>
    matches.filter(({ id }) => (!ids || ids.includes(id)) && !excludeIds?.includes(id));
  const search = {
    findPage: jest.fn(async ({ limit, ...scope }: InvestigationSearchScope & { limit: number }) => {
      const ids = inScope(scope).map(({ id }) => id);
      return { ids: ids.slice(0, limit), total: ids.length };
    }),
    findInProgressCandidates: jest.fn(async (scope: InvestigationSearchScope) =>
      inScope(scope)
        .filter(({ metadata }) => metadata?.status !== 'closed')
        .map(({ id, metadata }) => ({ id, metadata }))
    ),
  };
  return {
    search,
    searchService: { forRequest: jest.fn().mockResolvedValue(search) },
  };
};

const setup = ({
  searchResults = [],
  bulkGetResults = searchResults,
  subjects = [],
  impacts = [],
  hypotheses,
  inProgressIds = [],
  proposals,
  attachmentHolders = [],
}: {
  /** What the Elasticsearch search matches, in sort order. */
  searchResults?: ConversationWithoutRoundsWithPermissions[];
  /** What the caller's `bulkGet` can read; by default every search result. */
  bulkGetResults?: ConversationWithoutRoundsWithPermissions[];
  subjects?: InvestigationSubject[];
  impacts?: Impact[];
  hypotheses?: InvestigationHypotheses;
  inProgressIds?: string[];
  proposals?: ProposalsPluginStart;
  /** What a search by attachment id returns: conversations that hold such an attachment. */
  attachmentHolders?: ConversationWithoutRoundsWithPermissions[];
} = {}) => {
  const client = {
    get: jest.fn(),
    search: jest.fn(async ({ filter }: { filter: KueryNode; page?: number; perPage?: number }) => {
      const results = isAttachmentLookup(filter) ? attachmentHolders : [];
      return { results, total: results.length };
    }),
    bulkGet: jest
      .fn()
      .mockImplementation(
        async (ids: string[]) =>
          new Map(bulkGetResults.filter(({ id }) => ids.includes(id)).map((c) => [c.id, c]))
      ),
  };
  const subjectSearch = jest.fn().mockResolvedValue([]);
  const subjectsService = {
    listByConversationIds: jest.fn(async (ids: string[]) =>
      subjects.filter(({ conversationId }) => ids.includes(conversationId))
    ),
    findConversationIdsBySubjects: jest.fn().mockResolvedValue([]),
    getDocumentService: () => ({ searchConversationIds: subjectSearch }),
  };
  const impactSearch = jest.fn().mockResolvedValue([]);
  const impactService = {
    listByConversationIds: jest.fn(async (ids: string[]) =>
      impacts.filter(({ conversationId }) => ids.includes(conversationId))
    ),
    findByConversationId: jest.fn(async (id: string) =>
      impacts.find(({ conversationId }) => conversationId === id)
    ),
    getDocumentService: () => ({ searchConversationIds: impactSearch }),
  };
  const hypothesesService = {
    findByConversationId: jest.fn().mockResolvedValue(hypotheses),
  };
  const inProgress = {
    findInProgressIds: jest.fn(
      async (_r: unknown, _s: string, conversations: Array<{ id: string }>) =>
        new Set(conversations.map(({ id }) => id).filter((id) => inProgressIds.includes(id)))
    ),
    isInProgress: jest.fn(async (_r: unknown, _s: string, { id }: { id: string }) =>
      inProgressIds.includes(id)
    ),
  };
  const { search, searchService } = fakeSearch(searchResults);
  const service = new InvestigationsQueryService({
    getConversationClient: async () => client as unknown as ConversationPublicClient,
    getInvestigationsSearch: () => searchService,
    getSpaceId: () => SPACE_ID,
    getImpactService: () => impactService as unknown as ImpactService,
    getSubjectsService: () => subjectsService as unknown as SubjectsService,
    getHypothesesService: () => hypothesesService as unknown as HypothesesService,
    getProposals: () => proposals,
    inProgress: inProgress as unknown as InProgressResolver,
    logger: loggerMock.create(),
  });
  return {
    service,
    client,
    search,
    searchService,
    subjectsService,
    subjectSearch,
    impactSearch,
    inProgress,
  };
};

const isAttachmentLookup = (filter: KueryNode): boolean =>
  toKqlExpression(filter).includes('attachment_id');

describe('InvestigationsQueryService', () => {
  describe('get', () => {
    it('joins the conversation with its subjects, impact, hypotheses, and in-progress state', async () => {
      const hypotheses: InvestigationHypotheses = {
        id: 'hyp-conv-1',
        spaceId: SPACE_ID,
        conversationId: 'conv-1',
        hypotheses: [{ candidate: 'Bad deploy', confidence: 0.8, status: 'confirmed' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const { service, client, inProgress } = setup({
        subjects: [
          subject('conv-1', 'alert-2', { createdAt: '2026-01-02T00:00:00.000Z' }),
          subject('conv-1', 'alert-1', { triggerType: 'automatic', summary: 'High latency' }),
        ],
        impacts: [impact('conv-1')],
        hypotheses,
        inProgressIds: ['conv-1'],
      });
      client.get.mockResolvedValue({
        ...conversation('conv-1', {
          metadata: {
            status: 'open',
            severity: 'high',
            summary: 'What happened',
            verdict: 'Root cause',
            workflow_execution_ids: ['exec-1'],
          },
        }),
        attachments: [],
      });

      const investigation = await service.get(request, 'conv-1');

      expect(inProgress.isInProgress).toHaveBeenCalledWith(
        request,
        SPACE_ID,
        expect.objectContaining({
          id: 'conv-1',
          metadata: expect.objectContaining({ workflow_execution_ids: ['exec-1'] }),
        })
      );

      expect(investigation).toEqual({
        id: 'conv-1',
        title: 'Investigation conv-1',
        title_pending: false,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        agent_id: 'agent-1',
        metadata: {
          status: 'open',
          severity: 'high',
          summary: 'What happened',
          verdict: 'Root cause',
        },
        in_progress: true,
        subjects: [
          {
            type: 'alert',
            id: 'alert-1',
            summary: 'High latency',
            trigger_type: 'automatic',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          { type: 'alert', id: 'alert-2', created_at: '2026-01-02T00:00:00.000Z' },
        ],
        impact: {
          summary: 'Checkout is down',
          entities: [{ id: 'checkout', name: 'checkout', feature_id: 'f-1' }],
          created_at: '2026-01-01T00:00:00.000Z',
        },
        hypotheses: {
          hypotheses: hypotheses.hypotheses,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        proposals: [],
      });
    });

    it('hides documents whose attachment the user removed', async () => {
      const { service, client } = setup({
        subjects: [subject('conv-1', 'alert-1'), subject('conv-1', 'alert-2')],
        impacts: [impact('conv-1')],
      });
      client.get.mockResolvedValue({
        ...conversation('conv-1'),
        attachments: [
          { id: 'doc-conv-1-alert-1', active: false },
          { id: 'impact-conv-1', active: false },
        ],
      });

      const investigation = await service.get(request, 'conv-1');

      expect(investigation.subjects.map(({ id }) => id)).toEqual(['alert-2']);
      expect(investigation.impact).toBeUndefined();
    });

    it('retries reading a conversation whose new index has no shard available yet', async () => {
      jest.useFakeTimers();
      try {
        const { service, client } = setup();
        const noShardAvailable = Object.assign(new Error('no_shard_available_action_exception'), {
          meta: {
            statusCode: 503,
            body: { error: { type: 'no_shard_available_action_exception' } },
          },
        });
        client.get
          .mockRejectedValueOnce(noShardAvailable)
          .mockResolvedValueOnce(conversation('conv-1'));

        const investigation = service.get(request, 'conv-1');
        await jest.advanceTimersByTimeAsync(TRANSIENT_SEARCH_RETRY_DELAYS_MS[0]);

        await expect(investigation).resolves.toMatchObject({ id: 'conv-1' });
        expect(client.get).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects a conversation on another template as not an investigation', async () => {
      const { service, client } = setup();
      client.get.mockResolvedValue(conversation('conv-1', { template_id: 'escalation' }));

      await expect(service.get(request, 'conv-1')).rejects.toBeInstanceOf(WrongTemplateError);
    });

    it('lists live proposals when the caller may read them', async () => {
      const list = jest.fn().mockResolvedValue({
        proposals: [
          {
            id: 'p-1',
            title: 'Roll back',
            comment: 'Roll back the deploy',
            status: 'pending',
            impact: 'high',
            confidence: 'medium',
            createdAt: '2026-01-01T00:00:00.000Z',
            actionInput: { secret: true },
          },
        ],
        total: 1,
      });
      const proposals = {
        getProposalsService: () => ({ list }),
        getProposalPrivileges: () => ({ assertCanRead: jest.fn().mockResolvedValue(undefined) }),
      } as unknown as ProposalsPluginStart;
      const { service, client } = setup({ proposals });
      client.get.mockResolvedValue(conversation('conv-1'));

      const { proposals: found } = await service.get(request, 'conv-1');

      expect(found).toEqual([
        {
          id: 'p-1',
          title: 'Roll back',
          comment: 'Roll back the deploy',
          status: 'pending',
          impact: 'high',
          confidence: 'medium',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conv-1', excludeSuperseded: true }),
        SPACE_ID,
        request
      );
    });

    it('returns no proposals when the caller may not read them', async () => {
      const list = jest.fn();
      const proposals = {
        getProposalsService: () => ({ list }),
        getProposalPrivileges: () => ({
          assertCanRead: jest.fn().mockRejectedValue(new Error('forbidden')),
        }),
      } as unknown as ProposalsPluginStart;
      const { service, client } = setup({ proposals });
      client.get.mockResolvedValue(conversation('conv-1'));

      await expect(service.get(request, 'conv-1')).resolves.toEqual(
        expect.objectContaining({ proposals: [] })
      );
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('passes the filters, the sort, and the depth of the page to the search', async () => {
      const { service, search, client } = setup();

      const query = parseQuery({
        status: 'open',
        severity: ['high', 'none'],
        query: 'checkout',
        created_after: '2026-01-01T00:00:00.000Z',
        sort_field: 'severity',
        sort_order: 'asc',
        page: 3,
        per_page: 20,
      });
      await service.list(request, query);

      expect(search.findPage).toHaveBeenCalledWith({
        filters: query,
        ids: undefined,
        sort: { field: 'severity', order: 'asc' },
        limit: 60,
      });
      expect(search.findInProgressCandidates).not.toHaveBeenCalled();
      expect(client.bulkGet).not.toHaveBeenCalled();
    });

    it('reads and hydrates only the requested page, in the order of the search', async () => {
      const { service, client, subjectsService } = setup({
        searchResults: [conversation('b'), conversation('c'), conversation('a')],
      });

      const response = await service.list(request, parseQuery({ page: 2, per_page: 1 }));

      expect(response.pagination).toEqual({ total: 3, page: 2, per_page: 1 });
      expect(response.results.map(({ id }) => id)).toEqual(['c']);
      expect(client.bulkGet).toHaveBeenCalledWith(['c']);
      expect(subjectsService.listByConversationIds).toHaveBeenCalledWith(['c'], SPACE_ID);
    });

    it('reports the exact total, beyond the pages it can reach', async () => {
      const matches = Array.from({ length: 1500 }, (_, i) => conversation(`conv-${i}`));
      const { service } = setup({ searchResults: matches });

      const response = await service.list(request, parseQuery({ per_page: 100, page: 10 }));

      expect(response.pagination.total).toBe(1500);
      expect(response.results[0].id).toBe('conv-900');
    });

    it('leaves out a conversation the caller cannot read', async () => {
      const { service } = setup({
        searchResults: [conversation('readable'), conversation('gone')],
        bulkGetResults: [conversation('readable')],
      });

      const { results } = await service.list(request, parseQuery());

      expect(results.map(({ id }) => id)).toEqual(['readable']);
    });

    it('returns nothing when the user can read no investigation', async () => {
      const { service, searchService, client } = setup();
      searchService.forRequest.mockResolvedValue({
        findPage: async () => ({ ids: [], total: 0 }),
        findInProgressCandidates: async () => [],
      });

      const response = await service.list(request, parseQuery());

      expect(response).toEqual({ results: [], pagination: { total: 0, page: 1, per_page: 20 } });
      expect(client.bulkGet).not.toHaveBeenCalled();
    });

    it('starts from the subject index for subject filters and searches within its ids', async () => {
      const { service, search, subjectSearch } = setup({ searchResults: [conversation('conv-1')] });
      subjectSearch.mockResolvedValue(['conv-1', 'other', 'inaccessible']);

      const { results } = await service.list(
        request,
        parseQuery({ subject_type: 'alert', subject_id: ['alert-1', 'alert-2'] })
      );

      expect(subjectSearch).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        size: 10_000,
        filter: [
          { terms: { subjectType: ['alert'] } },
          { terms: { subjectId: ['alert-1', 'alert-2'] } },
        ],
      });
      expect(search.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ ids: ['conv-1', 'other', 'inaccessible'] })
      );
      expect(results.map(({ id }) => id)).toEqual(['conv-1']);
    });

    it('intersects the entity filter with the subject filter', async () => {
      const { service, search, subjectSearch, impactSearch } = setup();
      subjectSearch.mockResolvedValue(['conv-1', 'conv-2']);
      impactSearch.mockResolvedValue(['conv-2', 'conv-3']);

      await service.list(request, parseQuery({ subject_id: 'alert-1', entity: 'checkout' }));

      expect(impactSearch).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        size: 10_000,
        filter: [
          {
            nested: {
              path: 'entities',
              query: {
                bool: {
                  should: [
                    { term: { 'entities.id': 'checkout' } },
                    { term: { 'entities.name': 'checkout' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
          },
        ],
      });
      expect(search.findPage).toHaveBeenCalledWith(expect.objectContaining({ ids: ['conv-2'] }));
    });

    it('returns nothing without searching when the side indexes match nothing', async () => {
      const { service, searchService, client, impactSearch } = setup();
      impactSearch.mockResolvedValue([]);

      const response = await service.list(request, parseQuery({ entity: 'checkout' }));

      expect(response.results).toEqual([]);
      expect(searchService.forRequest).not.toHaveBeenCalled();
      expect(client.bulkGet).not.toHaveBeenCalled();
    });

    it('searches within the requested ids', async () => {
      const { service, search } = setup({
        searchResults: [conversation('conv-1'), conversation('conv-2'), conversation('conv-3')],
      });

      const response = await service.list(request, parseQuery({ id: ['conv-1', 'conv-2'] }));

      expect(search.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ ids: ['conv-1', 'conv-2'] })
      );
      expect(response.results.map(({ id }) => id)).toEqual(['conv-1', 'conv-2']);
    });

    it('resolves the in-progress state for the returned page only', async () => {
      const { service, inProgress, search } = setup({
        searchResults: [conversation('newest'), conversation('busy'), conversation('oldest')],
        inProgressIds: ['busy', 'oldest'],
      });

      const response = await service.list(request, parseQuery({ per_page: 2 }));

      expect(search.findInProgressCandidates).not.toHaveBeenCalled();
      expect(inProgress.findInProgressIds).toHaveBeenCalledTimes(1);
      expect(inProgress.findInProgressIds).toHaveBeenCalledWith(request, SPACE_ID, [
        expect.objectContaining({ id: 'newest' }),
        expect.objectContaining({ id: 'busy' }),
      ]);
      expect(response.results.map(({ id, in_progress: busy }) => ({ id, busy }))).toEqual([
        { id: 'newest', busy: false },
        { id: 'busy', busy: true },
      ]);
    });

    it('resolves in_progress=true once over the candidates and pages the ones in progress', async () => {
      const { service, inProgress, search } = setup({
        searchResults: [
          conversation('idle'),
          conversation('busy-new'),
          conversation('busy-old'),
          conversation('closed', { metadata: { status: 'closed' } }),
        ],
        inProgressIds: ['busy-new', 'busy-old'],
      });

      const response = await service.list(
        request,
        parseQuery({ in_progress: 'true', query: 'checkout', per_page: 1 })
      );

      expect(search.findInProgressCandidates).toHaveBeenCalledWith({
        filters: expect.objectContaining({ in_progress: true, query: 'checkout' }),
        ids: undefined,
      });
      // The page reuses the state the filter resolved instead of resolving it again.
      expect(inProgress.findInProgressIds).toHaveBeenCalledTimes(1);
      expect(inProgress.findInProgressIds).toHaveBeenCalledWith(request, SPACE_ID, [
        expect.objectContaining({ id: 'idle' }),
        expect.objectContaining({ id: 'busy-new' }),
        expect.objectContaining({ id: 'busy-old' }),
      ]);
      expect(search.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ ids: ['busy-new', 'busy-old'] })
      );
      expect(response.pagination.total).toBe(2);
      expect(response.results.map(({ id, in_progress: busy }) => ({ id, busy }))).toEqual([
        { id: 'busy-new', busy: true },
      ]);
    });

    it('returns nothing for in_progress=true without listing when none is in progress', async () => {
      const { service, search } = setup({ searchResults: [conversation('idle')] });

      const response = await service.list(request, parseQuery({ in_progress: 'true' }));

      expect(response.pagination.total).toBe(0);
      expect(search.findPage).not.toHaveBeenCalled();
    });

    it('excludes the investigations in progress for in_progress=false', async () => {
      const { service, search } = setup({
        searchResults: [conversation('busy'), conversation('idle')],
        inProgressIds: ['busy'],
      });

      const response = await service.list(request, parseQuery({ in_progress: 'false' }));

      expect(search.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ excludeIds: ['busy'] })
      );
      expect(response.pagination.total).toBe(1);
      expect(response.results.map(({ id, in_progress: busy }) => ({ id, busy }))).toEqual([
        { id: 'idle', busy: false },
      ]);
    });

    it('counts pending proposals per investigation when the caller may read them', async () => {
      const countPendingByConversationIds = jest.fn().mockResolvedValue(new Map([['conv-1', 2]]));
      const proposals = {
        getProposalsService: () => ({ countPendingByConversationIds }),
        getProposalPrivileges: () => ({ assertCanRead: jest.fn().mockResolvedValue(undefined) }),
      } as unknown as ProposalsPluginStart;
      const { service } = setup({
        searchResults: [conversation('conv-1'), conversation('conv-2')],
        proposals,
      });

      const { results } = await service.list(request, parseQuery());

      expect(countPendingByConversationIds).toHaveBeenCalledWith(['conv-1', 'conv-2'], SPACE_ID);
      expect(results.map((item) => [item.id, item.pending_proposal_count])).toEqual([
        ['conv-1', 2],
        ['conv-2', 0],
      ]);
    });

    it('leaves the pending proposal count out when the caller may not read proposals', async () => {
      const countPendingByConversationIds = jest.fn();
      const proposals = {
        getProposalsService: () => ({ countPendingByConversationIds }),
        getProposalPrivileges: () => ({
          assertCanRead: jest.fn().mockRejectedValue(new Error('forbidden')),
        }),
      } as unknown as ProposalsPluginStart;
      const { service } = setup({ searchResults: [conversation('conv-1')], proposals });

      const { results } = await service.list(request, parseQuery());

      expect(countPendingByConversationIds).not.toHaveBeenCalled();
      expect(results[0]).not.toHaveProperty('pending_proposal_count');
    });

    it('reports a title Agent Builder has not generated yet', async () => {
      const { service } = setup({
        searchResults: [
          conversation('pending', { title: DEFAULT_CONVERSATION_TITLE }),
          conversation('titled', { title: 'Conversation pool exhausted' }),
        ],
      });

      const { results } = await service.list(request, parseQuery());
      expect(results.map(({ id, title_pending: titlePending }) => ({ id, titlePending }))).toEqual([
        { id: 'pending', titlePending: true },
        { id: 'titled', titlePending: false },
      ]);
    });

    it('hides a removed document with one attachment lookup instead of reading the conversation', async () => {
      const { service, client } = setup({
        searchResults: [
          conversation('attached', {
            attachments: [{ id: 'doc-attached-alert-1', type: 'investigation_subject' }],
          }),
          conversation('removed'),
          conversation('running'),
        ],
        subjects: [
          subject('attached', 'alert-1'),
          subject('removed', 'alert-1'),
          subject('running', 'alert-1'),
        ],
        // The search by attachment id finds the removed one; the running turn never attached.
        attachmentHolders: [conversation('removed')],
      });

      const { results } = await service.list(request, parseQuery());

      expect(client.get).not.toHaveBeenCalled();
      const lookups = client.search.mock.calls
        .map(([{ filter }]) => toKqlExpression(filter as KueryNode))
        .filter((kql) => kql.includes('attachment_id'));
      expect(lookups).toHaveLength(1);
      expect(lookups[0]).toContain('doc-removed-alert-1');
      expect(lookups[0]).toContain('doc-running-alert-1');
      expect(lookups[0]).not.toContain('doc-attached-alert-1');
      const byId = new Map(results.map((result) => [result.id, result]));
      expect(byId.get('attached')?.subjects).toHaveLength(1);
      expect(byId.get('removed')?.subjects).toEqual([]);
      expect(byId.get('running')?.subjects).toHaveLength(1);
    });

    it('keeps a document whose attachment became active after the list read', async () => {
      const { service } = setup({
        searchResults: [conversation('ended')],
        impacts: [impact('ended')],
        attachmentHolders: [
          conversation('ended', {
            attachments: [{ id: 'impact-ended', type: 'investigation_impact' }],
          }),
        ],
      });

      const { results } = await service.list(request, parseQuery());

      expect(results[0].impact).toBeDefined();
    });

    it('reads the conversation in full only when several of its documents are unconfirmed', async () => {
      const { service, client } = setup({
        searchResults: [conversation('mixed')],
        subjects: [subject('mixed', 'alert-1'), subject('mixed', 'alert-2')],
        attachmentHolders: [conversation('mixed')],
      });
      client.get.mockResolvedValue({
        ...conversation('mixed'),
        attachments: [{ id: 'doc-mixed-alert-1', active: false }],
      });

      const { results } = await service.list(request, parseQuery());

      expect(client.get).toHaveBeenCalledWith('mixed');
      expect(results[0].subjects.map(({ id }) => id)).toEqual(['alert-2']);
    });

    it('does not look up attachments when every document is attached', async () => {
      const { service, client } = setup({
        searchResults: [
          conversation('attached', {
            attachments: [{ id: 'impact-attached', type: 'investigation_impact' }],
          }),
        ],
        impacts: [impact('attached')],
      });

      await service.list(request, parseQuery());

      expect(client.search).not.toHaveBeenCalled();
      expect(client.get).not.toHaveBeenCalled();
    });
  });

  describe('findOpenBySubjects', () => {
    it('returns open investigations holding a visible matching subject, most recently updated first', async () => {
      const { service, subjectsService } = setup({
        bulkGetResults: [
          conversation('old', {
            updated_at: '2026-01-01T00:00:00.000Z',
            attachments: [{ id: 'doc-old-alert-1', type: 'investigation_subject' }],
          }),
          conversation('new', {
            updated_at: '2026-01-05T00:00:00.000Z',
            attachments: [{ id: 'doc-new-alert-1', type: 'investigation_subject' }],
          }),
          conversation('closed', { metadata: { status: 'closed' } }),
          conversation('removed'),
        ],
        subjects: [
          subject('old', 'alert-1'),
          subject('new', 'alert-1'),
          subject('closed', 'alert-1'),
          subject('removed', 'alert-1'),
        ],
        attachmentHolders: [conversation('removed')],
      });
      subjectsService.findConversationIdsBySubjects.mockResolvedValue([
        'old',
        'new',
        'closed',
        'removed',
      ]);

      const found = await service.findOpenBySubjects(request, [{ type: 'alert', id: 'alert-1' }]);

      expect(found.map(({ id }) => id)).toEqual(['new', 'old']);
    });
  });

  describe('with the subject index', () => {
    /** The real subjects service over in-memory storage, so the index queries run for real. */
    const setupWithSubjectIndex = (
      conversations: ConversationWithoutRoundsWithPermissions[],
      attachmentHolders: ConversationWithoutRoundsWithPermissions[] = []
    ) => {
      const storage = createInMemoryStorage<SubjectDocument>();
      const subjectsService = new SubjectsService({
        documents: subjectAttachment.createServiceFromStorage(storage),
        claims: new SubjectClaimsService({
          storage: createInMemoryStorage<SubjectClaimDocument>(),
        }),
      });
      const seed = (
        conversationId: string,
        type: InvestigationSubject['subjectType'],
        id: string,
        spaceId = SPACE_ID
      ) => {
        const docId = subjectDocumentId(spaceId, conversationId, { type, id });
        storage.put(docId, {
          spaceId,
          conversationId,
          subjectType: type,
          subjectId: id,
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        return docId;
      };
      const base = setup({ searchResults: conversations, attachmentHolders });
      const service = new InvestigationsQueryService({
        getConversationClient: async () => base.client as unknown as ConversationPublicClient,
        getInvestigationsSearch: () => base.searchService,
        getSpaceId: () => SPACE_ID,
        getImpactService: () =>
          ({
            listByConversationIds: jest.fn().mockResolvedValue([]),
            getDocumentService: () => ({ searchConversationIds: jest.fn() }),
          } as unknown as ImpactService),
        getSubjectsService: () => subjectsService,
        getHypothesesService: () =>
          ({ findByConversationId: jest.fn() } as unknown as HypothesesService),
        getProposals: () => undefined,
        inProgress: {
          findInProgressIds: jest.fn().mockResolvedValue(new Set()),
        } as unknown as InProgressResolver,
        logger: loggerMock.create(),
      });
      return { service, client: base.client, seed };
    };

    it('filters by subject id across subject types', async () => {
      const { service, seed } = setupWithSubjectIndex([
        conversation('a', { attachments: [] }),
        conversation('b'),
        conversation('c'),
      ]);
      seed('a', 'alert', 'alert-1');
      seed('b', 'manual', 'alert-1');
      seed('c', 'alert', 'alert-2');

      const { results } = await service.list(request, parseQuery({ subject_id: 'alert-1' }));

      expect(results.map(({ id }) => id).sort()).toEqual(['a', 'b']);
      expect(results.find(({ id }) => id === 'a')?.subjects).toEqual([
        { type: 'alert', id: 'alert-1', created_at: '2026-01-01T00:00:00.000Z' },
      ]);
    });

    it('filters by subject type and id together', async () => {
      const { service, seed } = setupWithSubjectIndex([conversation('a'), conversation('b')]);
      seed('a', 'alert', 'alert-1');
      seed('b', 'manual', 'alert-1');

      const { results } = await service.list(
        request,
        parseQuery({ subject_type: 'manual', subject_id: ['alert-1', 'other'] })
      );

      expect(results.map(({ id }) => id)).toEqual(['b']);
    });

    it('filters by subject type alone', async () => {
      const { service, seed } = setupWithSubjectIndex([conversation('a'), conversation('b')]);
      seed('a', 'slack_thread', 'team:T/channel:C/thread:1');
      seed('b', 'alert', 'alert-1');

      const { results } = await service.list(request, parseQuery({ subject_type: 'slack_thread' }));

      expect(results.map(({ id }) => id)).toEqual(['a']);
    });

    it('ignores subjects recorded in another space', async () => {
      const { service, seed, client } = setupWithSubjectIndex([conversation('a')]);
      seed('a', 'alert', 'alert-1', 'other-space');

      const { results } = await service.list(request, parseQuery({ subject_id: 'alert-1' }));

      expect(results).toEqual([]);
      expect(client.bulkGet).not.toHaveBeenCalled();
    });

    it('finds the open investigations holding a subject, most recently updated first', async () => {
      const { service, seed } = setupWithSubjectIndex([
        conversation('old', { updated_at: '2026-01-01T00:00:00.000Z' }),
        conversation('new', { updated_at: '2026-01-03T00:00:00.000Z' }),
        conversation('closed', { metadata: { status: 'closed' } }),
        conversation('unrelated'),
      ]);
      const oldDoc = seed('old', 'alert', 'alert-1');
      const newDoc = seed('new', 'significant_event', 'event-1');
      seed('closed', 'alert', 'alert-1');
      seed('unrelated', 'alert', 'alert-9');

      const found = await service.findOpenBySubjects(request, [
        { type: 'alert', id: 'alert-1' },
        { type: 'significant_event', id: 'event-1' },
      ]);

      expect(found.map(({ id }) => id)).toEqual(['new', 'old']);
      expect(oldDoc).not.toBe(newDoc);
    });

    it('does not match an investigation whose subject attachment the user removed', async () => {
      const { service, seed, client } = setupWithSubjectIndex(
        [conversation('removed')],
        [conversation('removed')]
      );
      seed('removed', 'alert', 'alert-1');

      await expect(
        service.findOpenBySubjects(request, [{ type: 'alert', id: 'alert-1' }])
      ).resolves.toEqual([]);
      expect(client.get).not.toHaveBeenCalled();
    });
  });
});
