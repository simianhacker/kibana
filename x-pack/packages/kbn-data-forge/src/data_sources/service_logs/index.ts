/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { omit, range, sample } from 'lodash';
import { SERVICE_LOGS } from '../../constants';
import { Doc, GeneratorFunction } from '../../types';
import { generateService } from './lib/generate_service';
import { generateLogMessage } from './lib/generate_log_message';

export const generateEvent: GeneratorFunction = (config, _schedule, _index, timestamp) => {
  const { cardinality, seed } = config.indexing;

  const events = range(cardinality).map((id) => {
    const service = generateService(id + seed);
    const { hostsWithCloud } = service;
    const hostWithCloud = sample(hostsWithCloud);
    const scenario = config.indexing.scenario || 'good';
    return {
      namespace: SERVICE_LOGS,
      '@timestamp': timestamp.toISOString(),
      data_stream: { type: 'logs', dataset: SERVICE_LOGS, namespace: 'default' },
      service: omit(service, 'hostsWithCloud'),
      labels: {
        scenario,
      },
      ...hostWithCloud,
      ...generateLogMessage(timestamp),
    };
  }) as Doc[];

  return events;
};
