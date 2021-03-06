/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { PluginInitializerContext } from 'kibana/public';
import { TelemetryPlugin, TelemetryPluginConfig } from './plugin';
export type { TelemetryPluginStart, TelemetryPluginSetup, TelemetryPluginConfig } from './plugin';
export type { TelemetryNotifications, TelemetryService } from './services';

export function plugin(initializerContext: PluginInitializerContext<TelemetryPluginConfig>) {
  return new TelemetryPlugin(initializerContext);
}
