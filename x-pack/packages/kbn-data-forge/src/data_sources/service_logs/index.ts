/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { faker } from '@faker-js/faker';
import { omit } from 'lodash';
import { SERVICE_LOGS } from '../../constants';
import { GeneratorFunction } from '../../types';
import { generateService } from './lib/generate_service';
export { indexTemplate } from './ecs';

export const generateEvent: GeneratorFunction = async (
  config,
  _schedule,
  _index,
  timestamp,
  queue
) => {
  const { cardinality } = config.indexing;
  for (let i = 0; i < cardinality; i++) {
    const service = generateService(i + 1);
    const { hostsWithCloud } = service;
    for (let h = 0; h < hostsWithCloud.length; h++) {
      const hostWithCloud = hostsWithCloud[h];
      const doc = {
        namespace: SERVICE_LOGS,
        '@timestamp': timestamp.toISOString(),
        message: faker.git.commitMessage(),
        data_stream: { type: 'logs', dataset: SERVICE_LOGS },
        service: omit(service, 'hostsWithCloud'),
        ...hostWithCloud,
      };
      queue.push(doc);
    }
  }
  await queue.drain();
  return [];
};
