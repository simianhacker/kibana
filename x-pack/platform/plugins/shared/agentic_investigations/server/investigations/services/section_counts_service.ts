/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { INVESTIGATION_SEVERITY_NONE } from '../../../common/investigations/constants';
import type {
  InvestigationSectionCount,
  InvestigationSectionCounts,
  InvestigationSectionCountsQuery,
} from '../../../common/investigations/investigation';
import { isInvestigationSeverity } from '../../../common/investigations/severity';
import {
  buildTermsCondition,
  CONVERSATIONS_INDEX,
  InvestigationsEsql,
  SEARCH_TEXT_EVAL,
  STATUS_SEVERITY_EVAL,
  toSearchParams,
  toSearchTerms,
  type InvestigationsEsqlDeps,
} from './investigations_esql';

export type InvestigationSectionCountsServiceDeps = InvestigationsEsqlDeps;

const emptyCount = (): InvestigationSectionCount => ({ total: 0, matching: 0 });

const emptyCounts = (): InvestigationSectionCounts => ({
  open: {
    critical: emptyCount(),
    high: emptyCount(),
    medium: emptyCount(),
    low: emptyCount(),
    [INVESTIGATION_SEVERITY_NONE]: emptyCount(),
  },
  closed: emptyCount(),
});

/** Status and severity read the way `toMetadata` does; the text is what the list's `query` matches. */
export const buildSectionCountsEsql = (termCount: number): string => {
  if (termCount === 0) {
    return `FROM ${CONVERSATIONS_INDEX}
| EVAL ${STATUS_SEVERITY_EVAL}
| STATS total = COUNT(*), matching = COUNT(*) BY status, severity`;
  }
  return `FROM ${CONVERSATIONS_INDEX}
| EVAL ${STATUS_SEVERITY_EVAL},
       ${SEARCH_TEXT_EVAL}
| STATS total = COUNT(*), matching = COUNT(*) WHERE ${buildTermsCondition(
    termCount
  )} BY status, severity`;
};

/**
 * Counts the investigations of each home page group in one ES|QL query: open ones per severity,
 * and closed ones, each with and without the text query. Nothing is read into memory, so there is
 * no candidate cap.
 */
export class InvestigationSectionCountsService {
  private readonly esql: InvestigationsEsql;

  constructor(deps: InvestigationSectionCountsServiceDeps) {
    this.esql = new InvestigationsEsql(deps);
  }

  async count(
    request: KibanaRequest,
    { query }: InvestigationSectionCountsQuery
  ): Promise<InvestigationSectionCounts> {
    const esql = await this.esql.forRequest(request);
    if (!esql) {
      return emptyCounts();
    }
    const terms = toSearchTerms(query);
    const rows = await esql({
      query: buildSectionCountsEsql(terms.length),
      params: toSearchParams(terms),
    });

    const counts = emptyCounts();
    for (const { status, severity, total, matching } of rows) {
      const group =
        status === 'closed'
          ? counts.closed
          : counts.open[
              typeof severity === 'string' && isInvestigationSeverity(severity)
                ? severity
                : INVESTIGATION_SEVERITY_NONE
            ];
      group.total += Number(total ?? 0);
      group.matching += Number(matching ?? 0);
    }
    return counts;
  }
}
