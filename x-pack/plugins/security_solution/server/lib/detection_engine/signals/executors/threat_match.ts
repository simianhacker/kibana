/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SavedObject } from 'src/core/types';
import { Logger } from 'src/core/server';
import {
  AlertInstanceContext,
  AlertInstanceState,
  AlertServices,
} from '../../../../../../alerting/server';
import { ListClient } from '../../../../../../lists/server';
import { ExceptionListItemSchema } from '../../../../../common/shared_imports';
import { RefreshTypes } from '../../types';
import { getInputIndex } from '../get_input_output_index';
import { RuleRangeTuple, AlertAttributes } from '../types';
import { TelemetryEventsSender } from '../../../telemetry/sender';
import { BuildRuleMessage } from '../rule_messages';
import { createThreatSignals } from '../threat_mapping/create_threat_signals';
import { ThreatRuleParams } from '../../schemas/rule_schemas';

export const threatMatchExecutor = async ({
  rule,
  tuples,
  listClient,
  exceptionItems,
  services,
  version,
  searchAfterSize,
  logger,
  refresh,
  eventsTelemetry,
  buildRuleMessage,
}: {
  rule: SavedObject<AlertAttributes<ThreatRuleParams>>;
  tuples: RuleRangeTuple[];
  listClient: ListClient;
  exceptionItems: ExceptionListItemSchema[];
  services: AlertServices<AlertInstanceState, AlertInstanceContext, 'default'>;
  version: string;
  searchAfterSize: number;
  logger: Logger;
  refresh: RefreshTypes;
  eventsTelemetry: TelemetryEventsSender | undefined;
  buildRuleMessage: BuildRuleMessage;
}) => {
  const ruleParams = rule.attributes.params;
  const inputIndex = await getInputIndex(services, version, ruleParams.index);
  return createThreatSignals({
    tuples,
    threatMapping: ruleParams.threatMapping,
    query: ruleParams.query,
    inputIndex,
    type: ruleParams.type,
    filters: ruleParams.filters ?? [],
    language: ruleParams.language,
    savedId: ruleParams.savedId,
    services,
    exceptionItems,
    listClient,
    logger,
    eventsTelemetry,
    alertId: rule.id,
    outputIndex: ruleParams.outputIndex,
    ruleSO: rule,
    searchAfterSize,
    refresh,
    threatFilters: ruleParams.threatFilters ?? [],
    threatQuery: ruleParams.threatQuery,
    threatLanguage: ruleParams.threatLanguage,
    buildRuleMessage,
    threatIndex: ruleParams.threatIndex,
    threatIndicatorPath: ruleParams.threatIndicatorPath,
    concurrentSearches: ruleParams.concurrentSearches ?? 1,
    itemsPerSearch: ruleParams.itemsPerSearch ?? 9000,
  });
};
