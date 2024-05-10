/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  Plugin,
  CoreSetup,
  RequestHandlerContext,
  CoreStart,
  PluginInitializerContext,
  PluginConfigDescriptor,
  Logger,
} from '@kbn/core/server';

import { upsertComponent, upsertTemplate } from './lib/manage_index_templates';
import { setupRoutes } from './routes';
import { assetsIndexTemplateConfig } from './templates/assets_template';
import { AssetClient } from './lib/asset_client';
import { AssetManagerPluginSetupDependencies, AssetManagerPluginStartDependencies } from './types';
import { AssetManagerConfig, configSchema, exposeToBrowserConfig } from '../common/config';
import { oamBaseComponentTemplateConfig } from './templates/components/base';
import { oamAssetComponentTemplateConfig } from './templates/components/asset';
import { oamEventComponentTemplateConfig } from './templates/components/event';
import { oamIndexTemplateConfig } from './templates/oam_template';
import { oamDefinition } from './saved_objects';

export type AssetManagerServerPluginSetup = ReturnType<AssetManagerServerPlugin['setup']>;
export type AssetManagerServerPluginStart = ReturnType<AssetManagerServerPlugin['start']>;

export const config: PluginConfigDescriptor<AssetManagerConfig> = {
  schema: configSchema,
  exposeToBrowser: exposeToBrowserConfig,
};

export class AssetManagerServerPlugin
  implements
    Plugin<
      AssetManagerServerPluginSetup,
      AssetManagerServerPluginStart,
      AssetManagerPluginSetupDependencies,
      AssetManagerPluginStartDependencies
    >
{
  public config: AssetManagerConfig;
  public logger: Logger;

  constructor(context: PluginInitializerContext<AssetManagerConfig>) {
    this.config = context.config.get();
    this.logger = context.logger.get();
  }

  public setup(core: CoreSetup, plugins: AssetManagerPluginSetupDependencies) {
    // Check for config value and bail out if not "alpha-enabled"
    if (!this.config.alphaEnabled) {
      this.logger.info('Server is NOT enabled');
      return;
    }

    this.logger.info('Server is enabled');

    core.savedObjects.registerType(oamDefinition);

    const assetClient = new AssetClient({
      sourceIndices: this.config.sourceIndices,
      getApmIndices: plugins.apmDataAccess.getApmIndices,
      metricsClient: plugins.metricsDataAccess.client,
    });

    const router = core.http.createRouter();
    setupRoutes<RequestHandlerContext>({ router, assetClient, logger: this.logger });

    return {
      assetClient,
    };
  }

  public start(core: CoreStart) {
    // Check for config value and bail out if not "alpha-enabled"
    if (!this.config.alphaEnabled) {
      return;
    }

    const esClient = core.elasticsearch.client.asInternalUser;
    upsertTemplate({
      esClient,
      template: assetsIndexTemplateConfig,
      logger: this.logger,
    }).catch(() => {}); // it shouldn't reject, but just in case

    // Install OAM compoent templates and index template
    Promise.all([
      upsertComponent({ esClient, logger: this.logger, component: oamBaseComponentTemplateConfig }),
      upsertComponent({
        esClient,
        logger: this.logger,
        component: oamEventComponentTemplateConfig,
      }),
      upsertComponent({
        esClient,
        logger: this.logger,
        component: oamAssetComponentTemplateConfig,
      }),
    ])
      .then(() =>
        upsertTemplate({ esClient, logger: this.logger, template: oamIndexTemplateConfig })
      )
      .catch(() => {});

    return {};
  }

  public stop() {}
}
