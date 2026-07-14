'use strict';

/**
 * OPTIONAL AZURE APPLICATION INSIGHTS (Phase 8)
 *
 * Controlled entirely by APPLICATIONINSIGHTS_CONNECTION_STRING:
 *   - unset          → all track* calls are safe no-ops (local development)
 *   - set, SDK absent → warn once and stay disabled (SDK is installed by the
 *                       deploy pipeline, not required for the pilot repo)
 *   - set + SDK       → auto-collection of requests, exceptions, dependencies
 *                       (covers availability, 5xx, slow requests, DB failures)
 *                       plus the domain events tracked below.
 *
 * Privacy: a telemetry processor runs every envelope through the logger's
 * redactor so token/secret-shaped values never leave the process. Domain
 * events carry internal IDs only — no client names, clinical content,
 * appointment descriptions, or credentials.
 */

const { redact } = require('./logger');

let client = null;
let enabled = false;

function init(logger) {
  const conn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!conn) {
    logger.info('telemetry disabled — APPLICATIONINSIGHTS_CONNECTION_STRING not set');
    return false;
  }
  try {
    // Lazy require: the SDK is a production-only dependency.
    const appInsights = require('applicationinsights');
    appInsights
      .setup(conn)
      .setAutoCollectRequests(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectConsole(false) // console lines can contain pre-redaction text
      .setSendLiveMetrics(false);
    appInsights.defaultClient.addTelemetryProcessor((envelope) => {
      const data = envelope.data?.baseData;
      if (data?.properties) data.properties = redact(data.properties);
      if (data?.message) data.message = redact(data.message);
      if (data?.url) data.url = String(data.url).split('?')[0]; // never ship query strings
      return true;
    });
    appInsights.start();
    client = appInsights.defaultClient;
    enabled = true;
    logger.info('telemetry enabled — Application Insights connected');
    return true;
  } catch (err) {
    logger.warn('Application Insights SDK unavailable — telemetry disabled', {
      error: err.message,
    });
    return false;
  }
}

function trackEvent(name, properties) {
  if (!enabled) return;
  try { client.trackEvent({ name, properties: redact(properties || {}) }); } catch (_) {}
}

function trackException(error, properties) {
  if (!enabled) return;
  try {
    client.trackException({
      exception: error instanceof Error ? error : new Error(String(error)),
      properties: redact(properties || {}),
    });
  } catch (_) {}
}

function trackMetric(name, value) {
  if (!enabled) return;
  try { client.trackMetric({ name, value }); } catch (_) {}
}

function isEnabled() { return enabled; }

module.exports = { init, trackEvent, trackException, trackMetric, isEnabled };
