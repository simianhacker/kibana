/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import type {
  ConversationWithoutRoundsWithPermissions,
  MetadataFieldValue,
  VersionedAttachment,
} from '@kbn/agent-builder-common';
import type { ConversationPublicClient } from '@kbn/agent-builder-server';
import { nodeBuilder } from '@kbn/es-query';
import type { ProposalsPluginStart } from '@kbn/proposals-plugin/server';
import type { ProposalWithMetadata } from '@kbn/proposals-common';
import { INVESTIGATION_TEMPLATE_ID } from '../../../common/escalations/constants';
import type { InvestigationHypotheses } from '../../../common/hypotheses/hypotheses';
import type { Impact } from '../../../common/impact/impact';
import { MAX_INVESTIGATIONS_PAGE_SIZE } from '../../../common/investigations/constants';
import type {
  Investigation,
  InvestigationFilters,
  InvestigationImpactResponse,
  InvestigationMetadata,
  InvestigationProposalSummary,
  InvestigationSubjectResponse,
  InvestigationSummary,
  ListInvestigationsQuery,
  ListInvestigationsResponse,
} from '../../../common/investigations/investigation';
import { countPendingProposals } from './count_pending_proposals';
import { isInvestigationSeverity } from '../../../common/investigations/severity';
import { isInvestigationTitlePending } from '../../../common/investigations/title';
import type {
  InvestigationSubject,
  InvestigationSubjectKey,
} from '../../../common/subjects/subject';
import { WrongTemplateError } from '../../assignments/errors';
import type { HypothesesService } from '../../hypotheses/services/hypotheses_service';
import type { ImpactService } from '../../impact/services/impact_service';
import type { SubjectsService } from '../../subjects/services/subjects_service';
import { retryWhileShardUnavailable } from '../../investigation_attachments';
import { MAX_INVESTIGATION_CANDIDATE_CONVERSATION_IDS } from '../../investigation_attachments/attachment_doc_service';
import { bulkGetReadableConversations } from './readable_conversation_ids';
import type { InProgressResolver } from './in_progress';
import type {
  InvestigationSearch,
  InvestigationSearchScope,
  InvestigationsSearchService,
} from './investigations_search';

/** Bound on the proposals one investigation read returns. */
const MAX_INVESTIGATION_PROPOSALS = 100;

/**
 * Attachment ids one conversation search filters on. Agent Builder caps a filter at 100
 * expressions, and an `or` of N comparisons counts N + 1.
 */
const MAX_ATTACHMENT_IDS_PER_SEARCH = 50;

type ConversationSummary = ConversationWithoutRoundsWithPermissions;

export interface InvestigationsQueryServiceDeps {
  getConversationClient: (request: KibanaRequest) => Promise<ConversationPublicClient>;
  getInvestigationsSearch: () => Pick<InvestigationsSearchService, 'forRequest'>;
  getSpaceId: (request: KibanaRequest) => string;
  getImpactService: () => ImpactService;
  getSubjectsService: () => SubjectsService;
  getHypothesesService: () => HypothesesService;
  getProposals: () => ProposalsPluginStart | undefined;
  inProgress: InProgressResolver;
  logger: Logger;
}

/**
 * Reads investigations: Agent Builder conversations on the `investigation` template, joined with
 * the side indexes (subjects, impact, hypotheses), proposals, and the in-progress state.
 *
 * Lists run in phases. The side indexes are read as the internal user, scoped by space, and only
 * yield candidate conversation ids. Elasticsearch then filters, sorts, counts and pages the
 * investigations the caller can read (see {@link InvestigationsSearchService}), returning ids
 * only. The page's conversations are read as the caller (`bulkGet`) and hydrated.
 *
 * A side-index document whose conversation attachment exists but is inactive (the user removed
 * it) is hidden; a document that was never attached (an agent turn that has not ended yet) stays
 * visible. See {@link InvestigationsQueryService.findRemovedDocumentIds} for how lists tell the
 * two apart without reading every conversation in full.
 */
export class InvestigationsQueryService {
  constructor(private readonly deps: InvestigationsQueryServiceDeps) {}

  async get(request: KibanaRequest, id: string): Promise<Investigation> {
    const client = await this.deps.getConversationClient(request);
    const conversation = await retryWhileShardUnavailable(() => client.get(id));
    if (conversation.template_id !== INVESTIGATION_TEMPLATE_ID) {
      throw new WrongTemplateError(id, INVESTIGATION_TEMPLATE_ID);
    }

    const spaceId = this.deps.getSpaceId(request);
    const [subjects, impact, hypotheses, inProgress, proposals] = await Promise.all([
      this.deps.getSubjectsService().listByConversationIds([id], spaceId),
      this.deps.getImpactService().findByConversationId(id, spaceId),
      this.deps.getHypothesesService().findByConversationId(id, spaceId),
      this.deps.inProgress.isInProgress(request, spaceId, conversation),
      this.listProposals(request, id, spaceId),
    ]);

    const removed = removedAttachmentIds(conversation.attachments);
    const visibleHypotheses = hypotheses && !removed.has(hypotheses.id) ? hypotheses : undefined;
    return {
      ...toSummary({
        conversation,
        inProgress,
        subjects: subjects.filter(({ id: docId }) => !removed.has(docId)),
        impact: impact && !removed.has(impact.id) ? impact : undefined,
      }),
      ...(visibleHypotheses && { hypotheses: toHypothesesResponse(visibleHypotheses) }),
      proposals,
    };
  }

  async list(
    request: KibanaRequest,
    query: ListInvestigationsQuery
  ): Promise<ListInvestigationsResponse> {
    const { page, per_page: perPage, sort_field: field, sort_order: order } = query;
    const spaceId = this.deps.getSpaceId(request);
    const empty = { results: [], pagination: { total: 0, page, per_page: perPage } };

    const candidateIds = await this.findCandidateIds(spaceId, query);
    if (candidateIds?.length === 0) {
      return empty;
    }
    const search = await this.deps.getInvestigationsSearch().forRequest(request);
    const scope = await this.applyInProgressFilter({
      request,
      spaceId,
      search,
      filters: query,
      scope: { filters: query, ids: candidateIds },
    });
    if (!scope) {
      return empty;
    }

    const { ids, total } = await search.findPage({
      ...scope,
      sort: { field, order },
      limit: page * perPage,
    });
    const pageIds = ids.slice((page - 1) * perPage);
    const client = await this.deps.getConversationClient(request);
    const readable =
      pageIds.length > 0 ? await bulkGetReadableConversations(client, pageIds) : new Map();
    const results = await this.hydrate({
      request,
      client,
      spaceId,
      conversations: pageIds.flatMap((id) => readable.get(id) ?? []),
      inProgressIds: scope.inProgressIds,
    });
    return { results, pagination: { total, page, per_page: perPage } };
  }

  /**
   * Open investigations the caller can read that hold any of the subjects, most recently updated
   * first. A subject the user removed from an investigation does not match it.
   */
  async findOpenBySubjects(
    request: KibanaRequest,
    subjects: InvestigationSubjectKey[]
  ): Promise<InvestigationSummary[]> {
    if (subjects.length === 0) {
      return [];
    }
    const spaceId = this.deps.getSpaceId(request);
    const client = await this.deps.getConversationClient(request);
    const ids = await this.deps
      .getSubjectsService()
      .findConversationIdsBySubjects(subjects, spaceId);
    if (ids.length === 0) {
      return [];
    }

    const open = [...(await retryWhileShardUnavailable(() => client.bulkGet(ids))).values()]
      .filter(
        (conversation) =>
          conversation.template_id === INVESTIGATION_TEMPLATE_ID &&
          toMetadata(conversation.metadata).status === 'open'
      )
      .sort(byMostRecentlyUpdated)
      .slice(0, MAX_INVESTIGATIONS_PAGE_SIZE);
    if (open.length === 0) {
      return [];
    }

    const wanted = new Set(subjects.map(subjectKey));
    const hydrated = await this.hydrate({
      request,
      client,
      spaceId,
      conversations: open,
    });
    return hydrated.filter((investigation) =>
      investigation.subjects.some((subject) => wanted.has(subjectKey(subject)))
    );
  }

  /**
   * The search scope narrowed by `in_progress` when it is set, or undefined when nothing can
   * match. Running state is not stored, so it is resolved over the investigations that can be in
   * progress (see `findInProgressCandidates`): one in progress beyond the
   * `MAX_INVESTIGATION_CANDIDATES` most recently updated of them is not found. The ids in progress
   * are returned so the page reports the state the filter used.
   */
  private async applyInProgressFilter({
    request,
    spaceId,
    search,
    filters,
    scope,
  }: {
    request: KibanaRequest;
    spaceId: string;
    search: InvestigationSearch;
    filters: InvestigationFilters;
    scope: InvestigationSearchScope;
  }): Promise<(InvestigationSearchScope & { inProgressIds?: Set<string> }) | undefined> {
    if (filters.in_progress === undefined) {
      return scope;
    }
    const candidates = await search.findInProgressCandidates(scope);
    const inProgressIds = await this.deps.inProgress.findInProgressIds(
      request,
      spaceId,
      candidates
    );
    if (filters.in_progress) {
      return inProgressIds.size > 0
        ? { ...scope, ids: [...inProgressIds], inProgressIds }
        : undefined;
    }
    return { ...scope, excludeIds: [...inProgressIds], inProgressIds };
  }

  /**
   * Candidate ids from the side indexes, intersected. Undefined when no such filter is set, so
   * candidates come from a conversation search instead.
   */
  private async findCandidateIds(
    spaceId: string,
    filters: InvestigationFilters
  ): Promise<string[] | undefined> {
    const sets: string[][] = [];

    if (filters.id) {
      sets.push(filters.id);
    }

    const subjectFilter: QueryDslQueryContainer[] = [
      ...(filters.subject_type ? [{ terms: { subjectType: filters.subject_type } }] : []),
      ...(filters.subject_id ? [{ terms: { subjectId: filters.subject_id } }] : []),
    ];
    if (subjectFilter.length > 0) {
      sets.push(
        await this.deps.getSubjectsService().getDocumentService().searchConversationIds({
          spaceId,
          filter: subjectFilter,
          size: MAX_INVESTIGATION_CANDIDATE_CONVERSATION_IDS,
        })
      );
    }

    if (filters.entity !== undefined) {
      sets.push(
        await this.deps
          .getImpactService()
          .getDocumentService()
          .searchConversationIds({
            spaceId,
            size: MAX_INVESTIGATION_CANDIDATE_CONVERSATION_IDS,
            filter: [
              {
                nested: {
                  path: 'entities',
                  query: {
                    bool: {
                      should: [
                        { term: { 'entities.id': filters.entity } },
                        { term: { 'entities.name': filters.entity } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                },
              },
            ],
          })
      );
    }

    if (sets.length === 0) {
      return undefined;
    }
    const [first, ...rest] = sets;
    return rest.reduce(
      (intersection, next) => {
        const keep = new Set(next);
        return intersection.filter((id) => keep.has(id));
      },
      [...new Set(first)]
    );
  }

  private async hydrate({
    request,
    client,
    spaceId,
    conversations,
    inProgressIds: resolvedInProgressIds,
  }: {
    request: KibanaRequest;
    client: ConversationPublicClient;
    spaceId: string;
    conversations: ConversationSummary[];
    /** Already resolved for these conversations by the `in_progress` filter. */
    inProgressIds?: Set<string>;
  }): Promise<InvestigationSummary[]> {
    if (conversations.length === 0) {
      return [];
    }
    const ids = conversations.map(({ id }) => id);
    const [subjects, impacts, pendingProposalCounts, inProgressIds] = await Promise.all([
      this.deps.getSubjectsService().listByConversationIds(ids, spaceId),
      this.deps.getImpactService().listByConversationIds(ids, spaceId),
      countPendingProposals({
        proposals: this.deps.getProposals(),
        request,
        conversationIds: ids,
        spaceId,
        logger: this.deps.logger,
      }),
      resolvedInProgressIds ??
        this.deps.inProgress.findInProgressIds(request, spaceId, conversations),
    ]);
    const subjectsByConversation = groupBy(subjects, ({ conversationId }) => conversationId);
    const impactByConversation = new Map(impacts.map((impact) => [impact.conversationId, impact]));

    const removed = await this.findRemovedDocumentIds(
      client,
      conversations.map((conversation) => {
        const impact = impactByConversation.get(conversation.id);
        return {
          conversation,
          documentIds: [
            ...(subjectsByConversation.get(conversation.id) ?? []).map(({ id }) => id),
            ...(impact ? [impact.id] : []),
          ],
        };
      })
    );

    return conversations.map((conversation) => {
      const impact = impactByConversation.get(conversation.id);
      const summary = toSummary({
        conversation,
        inProgress: inProgressIds.has(conversation.id),
        subjects: (subjectsByConversation.get(conversation.id) ?? []).filter(
          ({ id }) => !removed.has(id)
        ),
        impact: impact && !removed.has(impact.id) ? impact : undefined,
      });
      return pendingProposalCounts
        ? { ...summary, pending_proposal_count: pendingProposalCounts.get(conversation.id) ?? 0 }
        : summary;
    });
  }

  /**
   * Document ids on the page whose conversation attachment the user removed.
   *
   * List rows carry only active attachment ids, so a document missing from its row was either
   * removed or never attached (an agent turn that has not ended). The conversation search filter
   * on `attachment_id` matches an attachment whether or not it is active, so one search per
   * chunk of such ids finds the conversations that hold one: a held id that is still not active
   * was removed. Only a conversation with several such ids in the same search is read in full,
   * to tell them apart. The cost no longer grows with every list call for every removed
   * attachment: steady state is one light search per page.
   */
  private async findRemovedDocumentIds(
    client: ConversationPublicClient,
    rows: Array<{ conversation: ConversationSummary; documentIds: string[] }>
  ): Promise<Set<string>> {
    const unconfirmed = rows.flatMap(({ conversation, documentIds }) => {
      const active = new Set((conversation.attachments ?? []).map(({ id }) => id));
      return documentIds
        .filter((id) => !active.has(id))
        .map((id) => ({ conversationId: conversation.id, id }));
    });

    const removed = new Set<string>();
    const ambiguous = new Set<string>();
    for (let start = 0; start < unconfirmed.length; start += MAX_ATTACHMENT_IDS_PER_SEARCH) {
      const chunk = unconfirmed.slice(start, start + MAX_ATTACHMENT_IDS_PER_SEARCH);
      let holders: ConversationSummary[];
      try {
        ({ results: holders } = await client.search({
          filter: nodeBuilder.or(chunk.map(({ id }) => nodeBuilder.is('attachment_id', id))),
          page: 1,
          perPage: chunk.length,
        }));
      } catch (error) {
        this.deps.logger.debug(`Could not look up removed attachments: ${errorMessage(error)}`);
        continue;
      }
      for (const holder of holders) {
        // Active by now (the turn ended after the list read): not removed.
        const activeNow = new Set((holder.attachments ?? []).map(({ id }) => id));
        const held = chunk.filter(
          ({ conversationId, id }) => conversationId === holder.id && !activeNow.has(id)
        );
        if (held.length === 1) {
          removed.add(held[0].id);
        } else if (held.length > 1) {
          ambiguous.add(holder.id);
        }
      }
    }

    await Promise.all(
      [...ambiguous].map(async (conversationId) => {
        try {
          const { attachments } = await client.get(conversationId);
          removedAttachmentIds(attachments).forEach((id) => removed.add(id));
        } catch (error) {
          this.deps.logger.debug(
            `Could not read attachments of investigation ${conversationId}: ${errorMessage(error)}`
          );
        }
      })
    );
    return removed;
  }

  /**
   * The investigation's live proposals. Empty when the proposals plugin is absent or the caller
   * may not read proposals, so an investigation read does not need the proposals privilege.
   */
  private async listProposals(
    request: KibanaRequest,
    conversationId: string,
    spaceId: string
  ): Promise<InvestigationProposalSummary[]> {
    const proposals = this.deps.getProposals();
    if (!proposals) {
      return [];
    }
    try {
      await proposals.getProposalPrivileges().assertCanRead(request);
    } catch {
      return [];
    }
    const { proposals: found } = await retryWhileShardUnavailable(() =>
      proposals.getProposalsService().list(
        {
          conversationId,
          excludeSuperseded: true,
          excludeExpired: false,
          size: MAX_INVESTIGATION_PROPOSALS,
          from: 0,
        },
        spaceId,
        request
      )
    );
    return found.map(toProposalSummary);
  }
}

const byMostRecentlyUpdated = (a: ConversationSummary, b: ConversationSummary): number =>
  Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id);

const optionalText = (value: MetadataFieldValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const toMetadata = (
  metadata: Record<string, MetadataFieldValue> | undefined
): InvestigationMetadata => {
  const severity = metadata?.severity;
  const summary = optionalText(metadata?.summary);
  const verdict = optionalText(metadata?.verdict);
  return {
    status: metadata?.status === 'closed' ? 'closed' : 'open',
    ...(isInvestigationSeverity(severity) && { severity }),
    ...(summary !== undefined && { summary }),
    ...(verdict !== undefined && { verdict }),
  };
};

const toSummary = ({
  conversation,
  inProgress,
  subjects,
  impact,
}: {
  conversation: Pick<
    ConversationSummary,
    'id' | 'title' | 'created_at' | 'updated_at' | 'agent_id' | 'metadata'
  >;
  inProgress: boolean;
  subjects: InvestigationSubject[];
  impact: Impact | undefined;
}): InvestigationSummary => ({
  id: conversation.id,
  title: conversation.title,
  title_pending: isInvestigationTitlePending(conversation.title),
  created_at: conversation.created_at,
  updated_at: conversation.updated_at,
  agent_id: conversation.agent_id,
  metadata: toMetadata(conversation.metadata),
  in_progress: inProgress,
  subjects: [...subjects]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toSubjectResponse),
  ...(impact && { impact: toImpactResponse(impact) }),
});

const toSubjectResponse = (subject: InvestigationSubject): InvestigationSubjectResponse => ({
  type: subject.subjectType,
  id: subject.subjectId,
  ...(subject.summary !== undefined && { summary: subject.summary }),
  ...(subject.triggerType !== undefined && { trigger_type: subject.triggerType }),
  ...(subject.snapshot !== undefined && { snapshot: subject.snapshot }),
  ...(subject.slack !== undefined && { slack: subject.slack }),
  created_at: subject.createdAt,
  ...(subject.updatedAt !== undefined && { updated_at: subject.updatedAt }),
});

const toImpactResponse = (impact: Impact): InvestigationImpactResponse => ({
  ...(impact.summary !== undefined && { summary: impact.summary }),
  ...(impact.evidence !== undefined && { evidence: impact.evidence }),
  entities: (impact.entities ?? []).map((entity) => ({
    id: entity.id,
    ...(entity.name !== undefined && { name: entity.name }),
    ...(entity.type !== undefined && { type: entity.type }),
    ...(entity.featureId !== undefined && { feature_id: entity.featureId }),
    ...(entity.streamName !== undefined && { stream_name: entity.streamName }),
    ...(entity.evidence !== undefined && { evidence: entity.evidence }),
  })),
  created_at: impact.createdAt,
  ...(impact.updatedAt !== undefined && { updated_at: impact.updatedAt }),
});

const toHypothesesResponse = (
  hypotheses: InvestigationHypotheses
): NonNullable<Investigation['hypotheses']> => ({
  hypotheses: hypotheses.hypotheses,
  created_at: hypotheses.createdAt,
  ...(hypotheses.updatedAt !== undefined && { updated_at: hypotheses.updatedAt }),
});

const toProposalSummary = (proposal: ProposalWithMetadata): InvestigationProposalSummary => ({
  id: proposal.id,
  title: proposal.title,
  comment: proposal.comment,
  status: proposal.status,
  impact: proposal.impact,
  confidence: proposal.confidence,
  ...(proposal.category !== undefined && { category: proposal.category }),
  created_at: proposal.createdAt,
  ...(proposal.decidedAt !== undefined && { decided_at: proposal.decidedAt }),
});

const removedAttachmentIds = (
  attachments: Array<Pick<VersionedAttachment, 'id' | 'active'>> | undefined
): Set<string> =>
  new Set((attachments ?? []).filter(({ active }) => active === false).map(({ id }) => id));

const subjectKey = ({ type, id }: InvestigationSubjectKey): string => `${type}\u0000${id}`;

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) {
      group.push(item);
    } else {
      groups.set(key(item), [item]);
    }
  }
  return groups;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
