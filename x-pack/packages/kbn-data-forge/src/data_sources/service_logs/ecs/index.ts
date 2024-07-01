/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import agent from './generated/elasticsearch/composable/component/agent.json';
import base from './generated/elasticsearch/composable/component/base.json';
import cloud from './generated/elasticsearch/composable/component/cloud.json';
import container from './generated/elasticsearch/composable/component/container.json';
import data_stream from './generated/elasticsearch/composable/component/data_stream.json';
import host from './generated/elasticsearch/composable/component/host.json';
import http from './generated/elasticsearch/composable/component/http.json';
import log from './generated/elasticsearch/composable/component/log.json';
import service from './generated/elasticsearch/composable/component/service.json';

import template from './generated/elasticsearch/composable/template.json';
import { IndexTemplateDef } from '../../../types';

const ECS_VERSION = template._meta.ecs_version;

const components = [
  { name: `service_logs_${ECS_VERSION}_agent`, template: agent },
  { name: `service_logs_${ECS_VERSION}_base`, template: base },
  { name: `service_logs_${ECS_VERSION}_cloud`, template: cloud },
  { name: `service_logs_${ECS_VERSION}_container`, template: container },
  { name: `service_logs_${ECS_VERSION}_data_stream`, template: data_stream },
  { name: `service_logs_${ECS_VERSION}_http`, template: http },
  { name: `service_logs_${ECS_VERSION}_host`, template: host },
  { name: `service_logs_${ECS_VERSION}_log`, template: log },
  { name: `service_services_${ECS_VERSION}_service`, template: service },
];

export const indexTemplate: IndexTemplateDef = {
  namespace: 'service_logs',
  template: { ...template, composed_of: components.map(({ name }) => name) },
  components,
};
