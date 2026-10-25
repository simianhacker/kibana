/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { tags, type ApiClientFixture } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import {
  apiTest,
  deleteConversations,
  getSectionCounts,
  INTERNAL_HEADERS,
  INVESTIGATIONS_PATH,
  sectionCountsOf,
  seedInvestigation,
  spaceUrl,
  type SectionCountsBody,
} from '../../fixtures';

interface ListBody {
  results: Array<{ id: string; metadata: { status: string; severity?: string } }>;
  pagination: { total: number; page: number; per_page: number };
}

const RUN = `scout-section-lists-${Date.now()}`;
// Its own Space, so totals hold only this suite's investigations.
const SPACE_ID = `inv-section-lists-${Date.now()}`;

const HIGH_COUNT = 12;

/** The home page's sections, as the Nightshift app asks for them, by `_section_counts` group. */
const SECTION_FILTERS = {
  critical: 'status=open&severity=critical',
  high: 'status=open&severity=high',
  medium: 'status=open&severity=medium',
  low: 'status=open&severity=low',
  none: 'status=open&severity=none',
  closed: 'status=closed',
} as const;

apiTest.describe(
  'GET /internal/investigations/investigations — section lists in Elasticsearch',
  { tag: [...tags.stateful.classic] },
  () => {
    let cookieHeader: Record<string, string>;
    // Oldest first, in creation order.
    const highIds: string[] = [];
    let otherIds: string[] = [];

    apiTest.beforeAll(async ({ apiServices, samlAuth, apiClient }) => {
      await apiServices.spaces.create({ id: SPACE_ID, name: SPACE_ID });
      ({ cookieHeader } = await samlAuth.asInteractiveUser('admin'));
      const seed = (title: string, metadata: Record<string, string>) =>
        seedInvestigation(apiClient, cookieHeader, { title, metadata, spaceId: SPACE_ID });

      // One at a time, so creation order (and the default newest-first sort) is known.
      for (let index = 0; index < HIGH_COUNT; index++) {
        highIds.push(
          await seed(`${RUN} high ${index}`, {
            status: 'open',
            severity: 'high',
            summary: index % 3 === 0 ? 'Gold token checkout fails' : 'Cart is slow',
          })
        );
      }
      otherIds = await Promise.all([
        seed(`${RUN} medium`, { status: 'open', severity: 'medium', verdict: 'gold token leak' }),
        seed(`${RUN} unrated`, { status: 'open', summary: 'gold token unrated' }),
        // A missing status reads as open, and its placeholder title never matches.
        seed('New conversation', { summary: 'no severity yet' }),
        seed(`${RUN} closed one`, {
          status: 'closed',
          severity: 'critical',
          summary: 'gold token',
        }),
        seed(`${RUN} closed two`, { status: 'closed', summary: 'resolved' }),
      ]);
    });

    apiTest.afterAll(async ({ apiServices, apiClient }) => {
      await deleteConversations(apiClient, [...highIds, ...otherIds], cookieHeader, SPACE_ID);
      await apiServices.spaces.delete(SPACE_ID);
    });

    const list = async (apiClient: ApiClientFixture, query: string): Promise<ListBody> => {
      const response = await apiClient.get(spaceUrl(`${INVESTIGATIONS_PATH}?${query}`, SPACE_ID), {
        headers: { ...INTERNAL_HEADERS, ...cookieHeader },
        responseType: 'json',
      });
      expect(response).toHaveStatusCode(200);
      return response.body as ListBody;
    };

    const countsFor = async (apiClient: ApiClientFixture, query?: string) => {
      const response = await getSectionCounts(apiClient, cookieHeader, {
        query,
        spaceId: SPACE_ID,
      });
      expect(response).toHaveStatusCode(200);
      return response.body as SectionCountsBody;
    };

    apiTest(
      'pages past the first page, newest first, with the exact total',
      async ({ apiClient }) => {
        const pages = await Promise.all(
          [1, 2, 3].map((page) =>
            list(apiClient, `${SECTION_FILTERS.high}&per_page=5&page=${page}`)
          )
        );

        expect(pages.map(({ pagination }) => pagination.total)).toStrictEqual([12, 12, 12]);
        expect(pages.map(({ results }) => results.length)).toStrictEqual([5, 5, 2]);
        expect(pages.flatMap(({ results }) => results.map(({ id }) => id))).toStrictEqual(
          [...highIds].reverse()
        );
      }
    );

    apiTest('sorts oldest first when asked', async ({ apiClient }) => {
      const body = await list(
        apiClient,
        `${SECTION_FILTERS.high}&per_page=3&sort_field=created_at&sort_order=asc`
      );

      expect(body.results.map(({ id }) => id)).toStrictEqual(highIds.slice(0, 3));
    });

    /** Each section's list total, with `extra` appended to its filter. */
    const sectionTotals = async (apiClient: ApiClientFixture, extra: string) =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(SECTION_FILTERS).map(async ([group, filter]) => [
            group,
            (await list(apiClient, `${filter}${extra}&per_page=1`)).pagination.total,
          ])
        )
      );

    apiTest('reports the same totals as the section counts', async ({ apiClient }) => {
      expect(await sectionTotals(apiClient, '')).toStrictEqual(
        sectionCountsOf(await countsFor(apiClient), 'matching')
      );
      expect(await sectionTotals(apiClient, '&query=gold%20token')).toStrictEqual(
        sectionCountsOf(await countsFor(apiClient, 'gold token'), 'matching')
      );
    });

    apiTest('searches every word in the title, summary, and verdict', async ({ apiClient }) => {
      const high = await list(apiClient, `${SECTION_FILTERS.high}&query=GOLD%20token&per_page=100`);
      expect(high.pagination.total).toBe(4);
      expect(high.results.map(({ id }) => id).sort()).toStrictEqual(
        highIds.filter((_, index) => index % 3 === 0).sort()
      );

      const medium = await list(apiClient, `${SECTION_FILTERS.medium}&query=leak`);
      expect(medium.results.map(({ id }) => id)).toStrictEqual([otherIds[0]]);

      const wildcard = await list(apiClient, `query=${encodeURIComponent('gol*')}`);
      expect(wildcard.pagination.total).toBe(0);

      const placeholder = await list(apiClient, 'query=conversation');
      expect(placeholder.pagination.total).toBe(0);
    });

    apiTest('lists the open ones without a severity as not rated', async ({ apiClient }) => {
      const body = await list(apiClient, SECTION_FILTERS.none);

      expect(body.pagination.total).toBe(2);
      expect(body.results.map(({ id }) => id).sort()).toStrictEqual(
        [otherIds[1], otherIds[2]].sort()
      );
    });

    apiTest('lists the closed ones whatever their severity', async ({ apiClient }) => {
      const body = await list(apiClient, SECTION_FILTERS.closed);

      expect(body.pagination.total).toBe(2);
      expect(body.results.map(({ id }) => id).sort()).toStrictEqual(
        [otherIds[3], otherIds[4]].sort()
      );
    });

    apiTest('sorts by severity rank, without a severity last', async ({ apiClient }) => {
      const body = await list(apiClient, 'sort_field=severity&sort_order=desc&per_page=100');

      expect(body.pagination.total).toBe(HIGH_COUNT + 5);
      expect(body.results.map(({ metadata }) => metadata.severity ?? 'none')).toStrictEqual([
        'critical',
        ...Array.from({ length: HIGH_COUNT }, () => 'high'),
        'medium',
        'none',
        'none',
        'none',
      ]);
    });

    apiTest('counts every investigation as idle when no worker runs', async ({ apiClient }) => {
      const idle = await list(apiClient, 'in_progress=false&per_page=1');
      expect(idle.pagination.total).toBe(HIGH_COUNT + 5);

      const busy = await list(apiClient, 'in_progress=true');
      expect(busy.pagination.total).toBe(0);
      expect(busy.results).toStrictEqual([]);
    });
  }
);
