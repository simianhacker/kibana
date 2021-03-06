/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import HttpProxyAgent from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Logger } from '../../../../../../src/core/server';
import { ActionsConfigurationUtilities } from '../../actions_config';

interface GetCustomAgentsResponse {
  httpAgent: HttpAgent | undefined;
  httpsAgent: HttpsAgent | undefined;
}

export function getCustomAgents(
  configurationUtilities: ActionsConfigurationUtilities,
  logger: Logger,
  url: string
): GetCustomAgentsResponse {
  const proxySettings = configurationUtilities.getProxySettings();
  const defaultAgents = {
    httpAgent: undefined,
    httpsAgent: new HttpsAgent({
      rejectUnauthorized: configurationUtilities.isRejectUnauthorizedCertificatesEnabled(),
    }),
  };

  if (!proxySettings) {
    return defaultAgents;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch (err) {
    logger.warn(`error determining proxy state for invalid url "${url}", using default agents`);
    return defaultAgents;
  }

  // filter out hostnames in the proxy bypass or only lists
  const { hostname } = targetUrl;

  if (proxySettings.proxyBypassHosts) {
    if (proxySettings.proxyBypassHosts.has(hostname)) {
      return defaultAgents;
    }
  }

  if (proxySettings.proxyOnlyHosts) {
    if (!proxySettings.proxyOnlyHosts.has(hostname)) {
      return defaultAgents;
    }
  }
  logger.debug(`Creating proxy agents for proxy: ${proxySettings.proxyUrl}`);
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(proxySettings.proxyUrl);
  } catch (err) {
    logger.warn(`invalid proxy URL "${proxySettings.proxyUrl}" ignored`);
    return defaultAgents;
  }

  const httpAgent = new HttpProxyAgent(proxySettings.proxyUrl);
  const httpsAgent = (new HttpsProxyAgent({
    host: proxyUrl.hostname,
    port: Number(proxyUrl.port),
    protocol: proxyUrl.protocol,
    headers: proxySettings.proxyHeaders,
    // do not fail on invalid certs if value is false
    rejectUnauthorized: proxySettings.proxyRejectUnauthorizedCertificates,
  }) as unknown) as HttpsAgent;
  // vsCode wasn't convinced HttpsProxyAgent is an https.Agent, so we convinced it

  return { httpAgent, httpsAgent };
}
