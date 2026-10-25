/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { SecurityServiceStart } from '@kbn/core-security-server';
import { DEFAULT_CONVERSATION_TITLE } from '@kbn/agent-builder-common';
import { chatSystemIndex } from '@kbn/agent-builder-server';
import { INVESTIGATION_TEMPLATE_ID } from '../../../common/escalations/constants';
import {
  INVESTIGATION_SEVERITIES,
  INVESTIGATION_SEVERITY_NONE,
} from '../../../common/investigations/constants';
import { retryWhileShardUnavailable } from '../../investigation_attachments';
import { buildConversationReadFilter, resolveConversationReader } from './conversation_read_filter';

export const CONVERSATIONS_INDEX = chatSystemIndex('conversations');

/** A named ES|QL parameter, referenced in the query as `?name`. */
export type EsqlParam = Record<string, string>;

/** One result row, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

export interface InvestigationsEsqlDeps {
  /** Reads the conversations index; the read filter does the access check. */
  getInternalEsClient: () => ElasticsearchClient;
  getScopedEsClient: (request: KibanaRequest) => ElasticsearchClient;
  getSecurity: () => SecurityServiceStart;
  /** The agents the request's user can access: conversations on other agents are not readable. */
  getAccessibleAgentIds: (request: KibanaRequest) => Promise<string[]>;
  getSpaceId: (request: KibanaRequest) => string;
  logger: Logger;
}

/** Runs ES|QL over the investigations one request's user can read. */
export type ScopedInvestigationsEsql = (options: {
  query: string;
  params?: EsqlParam[];
  /** Query DSL clauses ANDed with the template and read access filters. */
  filter?: QueryDslQueryContainer[];
}) => Promise<EsqlRow[]>;

/**
 * `status` and `severity` columns read the way `toMetadata` does: a missing status is open, and
 * a missing or unknown severity is `none`.
 */
export const STATUS_SEVERITY_EVAL = `status = CASE(FIELD_EXTRACT(metadata, "status") == "closed", "closed", "open"),
       severity = CASE(FIELD_EXTRACT(metadata, "severity") IN (${INVESTIGATION_SEVERITIES.map(
         (severity) => `"${severity}"`
       ).join(', ')}), FIELD_EXTRACT(metadata, "severity"), "${INVESTIGATION_SEVERITY_NONE}")`;

/**
 * A `text` column holding what the `query` filter matches: the title (unless it is still Agent
 * Builder's placeholder), the summary, and the verdict, lower-cased and joined by newlines. It
 * needs the `?placeholder` parameter from {@link toSearchParams}. ES|QL reads `title` from its
 * lower-cased `caseless` subfield, so the placeholder is compared against `title.keyword`.
 */
export const SEARCH_TEXT_EVAL = `title_text = CASE(title IS NULL OR TRIM(title) == "" OR title.keyword == ?placeholder, "", title),
       text = TO_LOWER(CONCAT(title_text, "\\n",
         COALESCE(FIELD_EXTRACT(metadata, "summary"), ""), "\\n",
         COALESCE(FIELD_EXTRACT(metadata, "verdict"), "")))`;

/** The query's words, lower-cased: every one must appear in the {@link SEARCH_TEXT_EVAL} text. */
export const toSearchTerms = (query: string | undefined): string[] =>
  (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/** `LOCATE` matches each term literally, so `*` or `%` are not wildcards. */
export const buildTermsCondition = (termCount: number): string =>
  Array.from({ length: termCount }, (_, index) => `LOCATE(text, ?term${index}) > 0`).join(' AND ');

/** The parameters {@link SEARCH_TEXT_EVAL} and {@link buildTermsCondition} reference. */
export const toSearchParams = (terms: string[]): EsqlParam[] =>
  terms.length > 0
    ? [
        { placeholder: DEFAULT_CONVERSATION_TITLE },
        ...terms.map((term, index) => ({ [`term${index}`]: term })),
      ]
    : [];

const isMissingIndex = (error: unknown): boolean => {
  const { statusCode, message } = (error ?? {}) as { statusCode?: number; message?: string };
  return statusCode === 404 || /unknown index|index_not_found/i.test(message ?? '');
};

/**
 * ES|QL over the conversations index as the internal user. Agent Builder's conversation client
 * cannot run ES|QL, so every query carries our copy of its read filter (see
 * `conversation_read_filter.ts`) as the request filter: that filter is the access check.
 */
export class InvestigationsEsql {
  constructor(private readonly deps: InvestigationsEsqlDeps) {}

  /**
   * A query runner for the request's user, or undefined when they can read no investigation
   * because they can access no agent.
   */
  async forRequest(request: KibanaRequest): Promise<ScopedInvestigationsEsql | undefined> {
    const agentIds = await this.deps.getAccessibleAgentIds(request);
    if (agentIds.length === 0) {
      return undefined;
    }
    const reader = await resolveConversationReader({
      request,
      security: this.deps.getSecurity(),
      esClient: this.deps.getScopedEsClient(request),
    });
    const readFilter = [
      { term: { template_id: INVESTIGATION_TEMPLATE_ID } },
      ...buildConversationReadFilter({
        spaceId: this.deps.getSpaceId(request),
        reader,
        agentIds,
      }),
    ];

    return async ({ query, params = [], filter = [] }) => {
      let response: { columns: Array<{ name: string }>; values: unknown[][] };
      try {
        response = await retryWhileShardUnavailable(() =>
          this.deps.getInternalEsClient().esql.query({
            query,
            filter: { bool: { filter: [...readFilter, ...filter] } },
            params,
            format: 'json',
          })
        );
      } catch (error) {
        if (isMissingIndex(error)) {
          this.deps.logger.debug(`No investigation conversations to query yet: ${error}`);
          return [];
        }
        throw error;
      }
      const names = response.columns.map(({ name }) => name);
      return response.values.map((values) =>
        Object.fromEntries(names.map((name, index) => [name, values[index]]))
      );
    };
  }
}
