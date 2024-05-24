/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const ENTITY_VERSION = 'v1';
export const ENTITY_BASE_PREFIX = '.entities-observability';
export const ENTITY_HISTORY_BASE_PREFIX = `${ENTITY_BASE_PREFIX}.history-${ENTITY_VERSION}`;
export const ENTITY_SUMMARY_BASE_PREFIX = `${ENTITY_BASE_PREFIX}.summary-${ENTITY_VERSION}`;
export const ENTITY_HISTORY_TRANSFORM_PREFIX = `entity-history-${ENTITY_VERSION}`;
export const ENTITY_SUMMARY_TRANSFORM_PREFIX = `entity-summary-${ENTITY_VERSION}`;
export const ENTITY_DEFAULT_HISTORY_FREQUENCY = '1m';
export const ENTITY_DEFAULT_HISTORY_SYNC_DELAY = '60s';
export const ENTITY_DEFAULT_SUMMARY_FREQUENCY = '30s';
export const ENTITY_DEFAULT_SUMMARY_SYNC_DELAY = '1s';
export const ENTITY_DEFAULT_METADATA_LIMIT = 1000;
export const ENTITY_API_PREFIX = '/api/entities';
