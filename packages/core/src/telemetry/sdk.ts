/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JWTInput } from 'google-auth-library';
import type { Config } from '../config/config.js';
import {
  setTelemetrySdkInitialized,
  bufferTelemetryEvent,
} from './telemetryBuffer.js';

export { bufferTelemetryEvent };

let telemetryInitialized = false;

export function isTelemetrySdkInitialized(): boolean {
  return telemetryInitialized;
}

/**
 * Shell for initializeTelemetry that lazily loads the implementation.
 */
export async function initializeTelemetry(
  config: Config,
  credentials?: JWTInput,
): Promise<void> {
  if (!config.getTelemetryEnabled()) {
    return;
  }

  const { initializeTelemetry: initImpl } = await import(
    './sdkImplementation.js'
  );
  await initImpl(config, credentials);
  telemetryInitialized = true;
  setTelemetrySdkInitialized(true);
}

/**
 * Shell for flushTelemetry that lazily loads the implementation.
 */
export async function flushTelemetry(config: Config): Promise<void> {
  if (!telemetryInitialized) {
    return;
  }
  const { flushTelemetry: flushImpl } = await import('./sdkImplementation.js');
  await flushImpl(config);
}

/**
 * Shell for shutdownTelemetry that lazily loads the implementation.
 */
export async function shutdownTelemetry(
  config: Config,
  fromProcessExit = true,
): Promise<void> {
  if (!telemetryInitialized) {
    return;
  }
  const { shutdownTelemetry: shutdownImpl } = await import(
    './sdkImplementation.js'
  );
  await shutdownImpl(config, fromProcessExit);
  telemetryInitialized = false;
  setTelemetrySdkInitialized(false);
}
