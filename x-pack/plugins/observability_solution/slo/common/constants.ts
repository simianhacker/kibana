/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const INVALID_EQUATION_REGEX = /[^A-Z|+|\-|\s|\d+|\.|\(|\)|\/|\*|>|<|=|\?|\:|&|\!|\|]+/g;

export const ALERT_ACTION_ID = 'slo.burnRate.alert';
export const ALERT_ACTION = {
  id: ALERT_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.alertAction', {
    defaultMessage: 'Critical',
  }),
};

export const HIGH_PRIORITY_ACTION_ID = 'slo.burnRate.high';
export const HIGH_PRIORITY_ACTION = {
  id: HIGH_PRIORITY_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.highPriorityAction', {
    defaultMessage: 'High',
  }),
};

export const MEDIUM_PRIORITY_ACTION_ID = 'slo.burnRate.medium';
export const MEDIUM_PRIORITY_ACTION = {
  id: MEDIUM_PRIORITY_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.mediumPriorityAction', {
    defaultMessage: 'Medium',
  }),
};

export const LOW_PRIORITY_ACTION_ID = 'slo.burnRate.low';
export const LOW_PRIORITY_ACTION = {
  id: LOW_PRIORITY_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.lowPriorityAction', {
    defaultMessage: 'Low',
  }),
};

export const SUPPRESSED_PRIORITY_ACTION_ID = 'slo.burnRate.suppressed';
export const SUPPRESSED_PRIORITY_ACTION = {
  id: SUPPRESSED_PRIORITY_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.suppressedPriorityAction', {
    defaultMessage: 'Suppressed',
  }),
};

export const IMPROVING_PRIORITY_ACTION_ID = 'slo.burnRate.improving';
export const IMPROVING_PRIORITY_ACTION = {
  id: IMPROVING_PRIORITY_ACTION_ID,
  name: i18n.translate('xpack.slo.alerting.burnRate.improvingPriorityAction', {
    defaultMessage: 'Improving',
  }),
};

export const SLO_MODEL_VERSION = 2;
export const SLO_RESOURCES_VERSION = 3.2;
export const SLO_RESOURCES_VERSION_MAJOR = 3;

export const SLO_COMPONENT_TEMPLATE_MAPPINGS_NAME = '.slo-observability.sli-mappings';
export const SLO_COMPONENT_TEMPLATE_SETTINGS_NAME = '.slo-observability.sli-settings';

export const SLO_INDEX_TEMPLATE_NAME = '.slo-observability.sli';
export const SLO_INDEX_TEMPLATE_PATTERN = `.slo-observability.sli-*`;

export const SLO_DESTINATION_INDEX_NAME = `.slo-observability.sli-v${SLO_RESOURCES_VERSION}`;
export const SLO_DESTINATION_INDEX_PATTERN = `.slo-observability.sli-v${SLO_RESOURCES_VERSION_MAJOR}*`;

export const SLO_INGEST_PIPELINE_NAME = `.slo-observability.sli.pipeline-v${SLO_RESOURCES_VERSION}`;
export const SLO_INGEST_PIPELINE_INDEX_NAME_PREFIX = `.slo-observability.sli-v${SLO_RESOURCES_VERSION}.`;

export const SLO_SUMMARY_COMPONENT_TEMPLATE_MAPPINGS_NAME = '.slo-observability.summary-mappings';
export const SLO_SUMMARY_COMPONENT_TEMPLATE_SETTINGS_NAME = '.slo-observability.summary-settings';
export const SLO_SUMMARY_INDEX_TEMPLATE_NAME = '.slo-observability.summary';
export const SLO_SUMMARY_INDEX_TEMPLATE_PATTERN = `.slo-observability.summary-*`;

export const SLO_SUMMARY_DESTINATION_INDEX_NAME = `.slo-observability.summary-v${SLO_RESOURCES_VERSION}`; // store the summary document generated by transform
export const SLO_SUMMARY_TEMP_INDEX_NAME = `.slo-observability.summary-v${SLO_RESOURCES_VERSION}.temp`; // store the temporary summary document
export const SLO_SUMMARY_DESTINATION_INDEX_PATTERN = `.slo-observability.summary-v${SLO_RESOURCES_VERSION_MAJOR}*`; // include temp and non-temp summary indices

export const getSLOTransformId = (sloId: string, sloRevision: number) =>
  `slo-${sloId}-${sloRevision}`;

export const DEFAULT_SLO_PAGE_SIZE = 25;
export const DEFAULT_SLO_GROUPS_PAGE_SIZE = 25;

export const getSLOSummaryTransformId = (sloId: string, sloRevision: number) =>
  `slo-summary-${sloId}-${sloRevision}`;

export const getSLOSummaryPipelineId = (sloId: string, sloRevision: number) =>
  `.slo-observability.summary.pipeline-${sloId}-${sloRevision}`;

export const SYNTHETICS_INDEX_PATTERN = 'synthetics-*';
export const SYNTHETICS_DEFAULT_GROUPINGS = ['monitor.name', 'observer.geo.name', 'monitor.id'];
