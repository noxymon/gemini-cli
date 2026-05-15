/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '../utils/debugLogger.js';

const telemetryBuffer: Array<() => void | Promise<void>> = [];
let telemetryInitialized = false;

export function isTelemetrySdkInitialized(): boolean {
  return telemetryInitialized;
}

export function setTelemetrySdkInitialized(initialized: boolean): void {
  telemetryInitialized = initialized;
}

export function bufferTelemetryEvent(fn: () => void | Promise<void>): void {
  if (telemetryInitialized) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fn();
  } else {
    telemetryBuffer.push(fn);
  }
}

export async function flushTelemetryBuffer(): Promise<void> {
  if (!telemetryInitialized) return;
  while (telemetryBuffer.length > 0) {
    const fn = telemetryBuffer.shift();
    if (fn) {
      try {
        await fn();
      } catch (e) {
        debugLogger.error('Error executing buffered telemetry event', e);
      }
    }
  }
}
