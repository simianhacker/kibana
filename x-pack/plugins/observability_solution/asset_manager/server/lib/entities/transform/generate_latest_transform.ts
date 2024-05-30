/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EntityDefinition } from '@kbn/entities-schema';
import { TransformPutTransformRequest } from '@elastic/elasticsearch/lib/api/types';
import {
  ENTITY_DEFAULT_LATEST_FREQUENCY,
  ENTITY_DEFAULT_LATEST_SYNC_DELAY,
  ENTITY_LATEST_BASE_PREFIX,
} from '../../../../common/constants_entities';
import { generateLatestMetadataAggregations } from './generate_metadata_aggregations';
import { generateLatestIngestPipelineId } from '../ingest_pipeline/generate_latest_ingest_pipeline_id';
import { generateLatestTransformId } from './generate_latest_transform_id';
import { generateHistoryIndexName } from '../helpers/generate_index_name';
import { generateLatestMetricAggregations } from './generate_metric_aggregations';

export function generateLatestTransform(
  definition: EntityDefinition
): TransformPutTransformRequest {
  return {
    transform_id: generateLatestTransformId(definition),
    defer_validation: true,
    source: {
      index: `${generateHistoryIndexName(definition)}.*`,
    },
    dest: {
      index: `${ENTITY_LATEST_BASE_PREFIX}.noop`,
      pipeline: generateLatestIngestPipelineId(definition),
    },
    frequency: definition.latest.settings?.frequency ?? ENTITY_DEFAULT_LATEST_FREQUENCY,
    sync: {
      time: {
        field: definition.history.settings?.syncField ?? 'event.ingested',
        delay: definition.history.settings?.syncDelay ?? ENTITY_DEFAULT_LATEST_SYNC_DELAY,
      },
    },
    settings: {
      deduce_mappings: false,
      unattended: true,
    },
    pivot: {
      group_by: {
        ['entity.id']: {
          terms: { field: 'entity.id' },
        },
        ['entity.displayName']: {
          terms: { field: 'entity.displayName.keyword' },
        },
        ...definition.identityFields.reduce(
          (acc, id) => ({
            ...acc,
            [`entity.identityFields.${id.field}`]: {
              terms: { field: `entity.identityFields.${id.field}`, missing_bucket: id.optional },
            },
          }),
          {}
        ),
      },
      aggs: {
        ...generateLatestMetricAggregations(definition),
        ...generateLatestMetadataAggregations(definition),
        'entity.lastSeenTimestamp': {
          max: {
            field: 'entity.lastSeenTimestamp',
          },
        },
        'entity.firstSeenTimestamp': {
          min: {
            field: '@timestamp',
          },
        },
      },
    },
  };
}
