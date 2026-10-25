/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { KibanaRequest } from '@kbn/core/server';
import { MAX_INVESTIGATION_CANDIDATES } from '../../../common/investigations/constants';
import type {
  InvestigationFilters,
  ListInvestigationsQuery,
} from '../../../common/investigations/investigation';
import {
  buildTermsCondition,
  CONVERSATIONS_INDEX,
  SEARCH_TEXT_EVAL,
  STATUS_SEVERITY_EVAL,
  toSearchParams,
  toSearchTerms,
  type EsqlParam,
  type InvestigationsEsql,
  type ScopedInvestigationsEsql,
} from './investigations_esql';
import type { InProgressCandidate } from './in_progress';

/** The filters the search applies; `id`, subject, entity and `in_progress` arrive as `ids`. */
export type InvestigationSearchFilters = Pick<
  InvestigationFilters,
  'status' | 'severity' | 'query' | 'created_after' | 'created_before'
>;

export interface InvestigationSearchScope {
  filters: InvestigationSearchFilters;
  /** Only these investigations. */
  ids?: string[];
  /** Not these investigations. */
  excludeIds?: string[];
}

export interface InvestigationSort {
  field: ListInvestigationsQuery['sort_field'];
  order: ListInvestigationsQuery['sort_order'];
}

export interface InvestigationSearch {
  /** The first `limit` matching ids in `sort` order, and how many match in all. */
  findPage: (
    options: InvestigationSearchScope & { sort: InvestigationSort; limit: number }
  ) => Promise<{ ids: string[]; total: number }>;
  /**
   * The matching open investigations with recorded workflow executions, the ones that can be in
   * progress: the {@link MAX_INVESTIGATION_CANDIDATES} most recently updated, since recording an
   * execution updates the investigation.
   */
  findInProgressCandidates: (options: InvestigationSearchScope) => Promise<InProgressCandidate[]>;
}

interface BuiltQuery {
  query: string;
  params: EsqlParam[];
}

/**
 * The `FROM`, `EVAL` and `WHERE` commands shared by every list query, and their parameters.
 * Dates and ids are not here: they go in the Query DSL filter from {@link buildScopeFilter}.
 */
export const buildMatchCommands = (filters: InvestigationSearchFilters): BuiltQuery => {
  const terms = toSearchTerms(filters.query);
  const statuses = [...new Set(filters.status ?? [])];
  const severities = [...new Set(filters.severity ?? [])];
  const conditions = [
    ...(statuses.length > 0
      ? [`status IN (${statuses.map((_, index) => `?status${index}`).join(', ')})`]
      : []),
    ...(severities.length > 0
      ? [`severity IN (${severities.map((_, index) => `?severity${index}`).join(', ')})`]
      : []),
    ...(terms.length > 0 ? [buildTermsCondition(terms.length)] : []),
  ];
  const evals =
    terms.length > 0
      ? `${STATUS_SEVERITY_EVAL},\n       ${SEARCH_TEXT_EVAL}`
      : STATUS_SEVERITY_EVAL;
  return {
    query: [
      `FROM ${CONVERSATIONS_INDEX} METADATA _id`,
      `| EVAL ${evals}`,
      ...(conditions.length > 0 ? [`| WHERE ${conditions.join(' AND ')}`] : []),
    ].join('\n'),
    params: [
      ...statuses.map((status, index) => ({ [`status${index}`]: status })),
      ...severities.map((severity, index) => ({ [`severity${index}`]: severity })),
      ...toSearchParams(terms),
    ],
  };
};

/** Query DSL for the dates and the id scope, which ES|QL would need a parameter per id for. */
export const buildScopeFilter = ({
  filters,
  ids,
  excludeIds,
}: InvestigationSearchScope): QueryDslQueryContainer[] => {
  const createdAt = {
    ...(filters.created_after && { gte: filters.created_after }),
    ...(filters.created_before && { lte: filters.created_before }),
  };
  return [
    ...(Object.keys(createdAt).length > 0 ? [{ range: { created_at: createdAt } }] : []),
    ...(ids ? [{ ids: { values: ids } }] : []),
    ...(excludeIds && excludeIds.length > 0
      ? [{ bool: { must_not: [{ ids: { values: excludeIds } }] } }]
      : []),
  ];
};

const SEVERITY_RANK_EVAL = `| EVAL severity_rank = CASE(severity == "critical", 4, severity == "high", 3, severity == "medium", 2, severity == "low", 1, 0)`;

/**
 * Sorted the way the list always sorted: by the field, then most recently updated, then by id,
 * so pages are stable. Without a severity, the rank is 0: last when descending.
 */
export const buildSortCommands = ({ field, order }: InvestigationSort): string[] => {
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  const primary = field === 'severity' ? 'severity_rank' : field;
  const keys = [`${primary} ${direction}`, ...(field === 'updated_at' ? [] : ['updated_at DESC'])];
  return [
    ...(field === 'severity' ? [SEVERITY_RANK_EVAL] : []),
    `| SORT ${keys.join(', ')}, _id ASC`,
  ];
};

const toStringArray = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === 'string' && item.length > 0);
};

const createSearch = (esql: ScopedInvestigationsEsql): InvestigationSearch => ({
  findPage: async ({ sort, limit, ...scope }) => {
    const { query, params } = buildMatchCommands(scope.filters);
    const filter = buildScopeFilter(scope);
    const [page, [count]] = await Promise.all([
      esql({
        query: [query, ...buildSortCommands(sort), `| LIMIT ${limit}`, '| KEEP _id'].join('\n'),
        params,
        filter,
      }),
      esql({ query: `${query}\n| STATS total = COUNT(*)`, params, filter }),
    ]);
    return {
      ids: page.map(({ _id: id }) => id).filter((id): id is string => typeof id === 'string'),
      total: Number(count?.total ?? 0),
    };
  },

  findInProgressCandidates: async (scope) => {
    const { query, params } = buildMatchCommands(scope.filters);
    const rows = await esql({
      query: [
        query,
        '| EVAL workflow_execution_ids = FIELD_EXTRACT(metadata, "workflow_execution_ids")',
        '| WHERE status == "open" AND workflow_execution_ids IS NOT NULL',
        '| SORT updated_at DESC, _id ASC',
        `| LIMIT ${MAX_INVESTIGATION_CANDIDATES}`,
        '| KEEP _id, workflow_execution_ids',
      ].join('\n'),
      params,
      filter: buildScopeFilter(scope),
    });
    return rows.flatMap(({ _id: id, workflow_execution_ids: executionIds }) =>
      typeof id === 'string'
        ? [
            {
              id,
              metadata: { status: 'open', workflow_execution_ids: toStringArray(executionIds) },
            },
          ]
        : []
    );
  },
});

const EMPTY_SEARCH: InvestigationSearch = {
  findPage: async () => ({ ids: [], total: 0 }),
  findInProgressCandidates: async () => [],
};

/**
 * Filters, sorts, counts and pages investigations in Elasticsearch, with the same access check,
 * status, severity and text matching as the section counts. Only ids come back; the caller reads
 * the page's conversations through Agent Builder.
 */
export class InvestigationsSearchService {
  constructor(private readonly esql: InvestigationsEsql) {}

  async forRequest(request: KibanaRequest): Promise<InvestigationSearch> {
    const esql = await this.esql.forRequest(request);
    return esql ? createSearch(esql) : EMPTY_SEARCH;
  }
}
