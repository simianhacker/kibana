/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { SecurityServiceStart } from '@kbn/core-security-server';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import { loggingSystemMock } from '@kbn/core/server/mocks';
import { InvestigationsEsql } from './investigations_esql';
import {
  buildMatchCommands,
  buildScopeFilter,
  buildSortCommands,
  InvestigationsSearchService,
} from './investigations_search';

const request = httpServerMock.createKibanaRequest();

const setup = ({
  respond = () => ({ columns: [], values: [] }),
  agentIds = ['agent-1'],
}: {
  respond?: (query: string) => { columns: Array<{ name: string }>; values: unknown[][] };
  agentIds?: string[];
} = {}) => {
  const esqlQuery = jest.fn(
    async ({ query }: { query: string; params?: unknown; filter?: unknown }) => respond(query)
  );
  const esql = new InvestigationsEsql({
    getInternalEsClient: () => ({ esql: { query: esqlQuery } } as unknown as ElasticsearchClient),
    getScopedEsClient: () => ({} as unknown as ElasticsearchClient),
    getSecurity: () =>
      ({
        authc: {
          getCurrentUser: () => ({ username: 'jane', profile_uid: 'profile-1' }),
          getPrincipal: () => null,
        },
      } as unknown as SecurityServiceStart),
    getAccessibleAgentIds: async () => agentIds,
    getSpaceId: () => 'team-a',
    logger: loggingSystemMock.createLogger(),
  });
  return { service: new InvestigationsSearchService(esql), esqlQuery };
};

const pageAndTotal = (ids: string[], total: number) => (query: string) =>
  query.includes('STATS total')
    ? { columns: [{ name: 'total' }], values: [[total]] }
    : { columns: [{ name: '_id' }], values: ids.map((id) => [id]) };

describe('buildMatchCommands', () => {
  it('reads every investigation without filters', () => {
    const { query, params } = buildMatchCommands({});

    expect(query).toContain('FROM .chat-conversations METADATA _id');
    expect(query).not.toContain('WHERE');
    expect(query).not.toContain('LOCATE');
    expect(params).toEqual([]);
  });

  it('matches status and severity on the columns that read a missing value as open and none', () => {
    const { query, params } = buildMatchCommands({
      status: ['open'],
      severity: ['high', 'none', 'high'],
    });

    expect(query).toContain(
      'status = CASE(FIELD_EXTRACT(metadata, "status") == "closed", "closed", "open")'
    );
    expect(query).toContain(
      'severity = CASE(FIELD_EXTRACT(metadata, "severity") IN ("low", "medium", "high", "critical"), FIELD_EXTRACT(metadata, "severity"), "none")'
    );
    expect(query).toContain(
      '| WHERE status IN (?status0) AND severity IN (?severity0, ?severity1)'
    );
    expect(params).toEqual([{ status0: 'open' }, { severity0: 'high' }, { severity1: 'none' }]);
  });

  it('requires every lower-cased word of the query in the title, summary, or verdict', () => {
    const { query, params } = buildMatchCommands({ query: 'Gold  TOKEN*' });

    expect(query).toContain('title.keyword == ?placeholder, "", title)');
    expect(query).toContain('COALESCE(FIELD_EXTRACT(metadata, "summary"), "")');
    expect(query).toContain('COALESCE(FIELD_EXTRACT(metadata, "verdict"), "")');
    expect(query).not.toContain('description');
    expect(query).toContain('| WHERE LOCATE(text, ?term0) > 0 AND LOCATE(text, ?term1) > 0');
    expect(params).toEqual([
      { placeholder: 'New conversation' },
      { term0: 'gold' },
      { term1: 'token*' },
    ]);
  });
});

describe('buildScopeFilter', () => {
  it('filters by creation date and keeps or leaves out ids', () => {
    expect(
      buildScopeFilter({
        filters: {
          created_after: '2026-01-01T00:00:00.000Z',
          created_before: '2026-02-01T00:00:00.000Z',
        },
        ids: ['a', 'b'],
        excludeIds: ['b'],
      })
    ).toEqual([
      {
        range: {
          created_at: { gte: '2026-01-01T00:00:00.000Z', lte: '2026-02-01T00:00:00.000Z' },
        },
      },
      { ids: { values: ['a', 'b'] } },
      { bool: { must_not: [{ ids: { values: ['b'] } }] } },
    ]);
  });

  it('adds nothing without dates or ids', () => {
    expect(buildScopeFilter({ filters: {}, excludeIds: [] })).toEqual([]);
  });
});

describe('buildSortCommands', () => {
  it('sorts by a date, then most recently updated, then id', () => {
    expect(buildSortCommands({ field: 'created_at', order: 'asc' })).toEqual([
      '| SORT created_at ASC, updated_at DESC, _id ASC',
    ]);
    expect(buildSortCommands({ field: 'updated_at', order: 'desc' })).toEqual([
      '| SORT updated_at DESC, _id ASC',
    ]);
  });

  it('sorts by severity rank, without a severity last when descending', () => {
    const [rank, sort] = buildSortCommands({ field: 'severity', order: 'desc' });

    expect(rank).toBe(
      '| EVAL severity_rank = CASE(severity == "critical", 4, severity == "high", 3, severity == "medium", 2, severity == "low", 1, 0)'
    );
    expect(sort).toBe('| SORT severity_rank DESC, updated_at DESC, _id ASC');
  });
});

describe('InvestigationsSearchService', () => {
  it('returns the ids up to the limit and the total over every match', async () => {
    const { service, esqlQuery } = setup({ respond: pageAndTotal(['a', 'b'], 1500) });
    const search = await service.forRequest(request);

    await expect(
      search.findPage({
        filters: { severity: ['none'] },
        ids: ['a', 'b', 'c'],
        sort: { field: 'created_at', order: 'desc' },
        limit: 40,
      })
    ).resolves.toEqual({ ids: ['a', 'b'], total: 1500 });

    const [pageCall, totalCall] = esqlQuery.mock.calls.map(([body]) => body);
    expect(pageCall.query).toMatch(
      /\| SORT created_at DESC, updated_at DESC, _id ASC\n\| LIMIT 40\n\| KEEP _id$/
    );
    expect(totalCall.query).toMatch(/\| STATS total = COUNT\(\*\)$/);
    for (const { filter, params } of [pageCall, totalCall]) {
      expect(params).toEqual([{ severity0: 'none' }]);
      const clauses = JSON.stringify(filter);
      expect(clauses).toContain('{"term":{"template_id":"investigation"}}');
      expect(clauses).toContain('{"term":{"space":"team-a"}}');
      expect(clauses).toContain('{"terms":{"agent_id":["agent-1"]}}');
      expect(clauses).toContain('{"ids":{"values":["a","b","c"]}}');
    }
  });

  it('reads the open investigations with workflow executions, most recently updated first', async () => {
    const { service, esqlQuery } = setup({
      respond: () => ({
        columns: [{ name: '_id' }, { name: 'workflow_execution_ids' }],
        values: [
          ['a', 'exec-1'],
          ['b', ['exec-2', 'exec-3']],
        ],
      }),
    });
    const search = await service.forRequest(request);

    await expect(
      search.findInProgressCandidates({ filters: { query: 'checkout' } })
    ).resolves.toEqual([
      { id: 'a', metadata: { status: 'open', workflow_execution_ids: ['exec-1'] } },
      { id: 'b', metadata: { status: 'open', workflow_execution_ids: ['exec-2', 'exec-3'] } },
    ]);

    const [{ query }] = esqlQuery.mock.calls[0];
    expect(query).toContain('LOCATE(text, ?term0) > 0');
    expect(query).toContain('| WHERE status == "open" AND workflow_execution_ids IS NOT NULL');
    expect(query).toContain('| SORT updated_at DESC, _id ASC\n| LIMIT 1000');
  });

  it('finds nothing without querying when the user can access no agent', async () => {
    const { service, esqlQuery } = setup({ agentIds: [] });
    const search = await service.forRequest(request);

    await expect(
      search.findPage({ filters: {}, sort: { field: 'created_at', order: 'desc' }, limit: 20 })
    ).resolves.toEqual({ ids: [], total: 0 });
    await expect(search.findInProgressCandidates({ filters: {} })).resolves.toEqual([]);
    expect(esqlQuery).not.toHaveBeenCalled();
  });

  it('finds nothing before any conversation exists', async () => {
    const { service } = setup({
      respond: () => {
        throw Object.assign(new Error('Unknown index [.chat-conversations]'), { statusCode: 400 });
      },
    });
    const search = await service.forRequest(request);

    await expect(
      search.findPage({ filters: {}, sort: { field: 'created_at', order: 'desc' }, limit: 20 })
    ).resolves.toEqual({ ids: [], total: 0 });
  });
});
