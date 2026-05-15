/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attributes } from '@opentelemetry/api';
import type { Config } from '../config/config.js';
import { UserAccountManager } from '../utils/userAccountManager.js';

const userAccountManager = new UserAccountManager();
let installationId: string | undefined = undefined;
let isInitialized = false;

/**
 * Initializes common attributes asynchronously.
 * This should be called and awaited during telemetry startup.
 */
export async function initializeCommonAttributes(): Promise<void> {
  if (isInitialized) return;

  try {
    const { InstallationManager } = await import(
      '../utils/installationManager.js'
    );
    const installationManager = new InstallationManager();
    installationId = installationManager.getInstallationId();
    isInitialized = true;
  } catch (error) {
    // Fallback if installation manager fails to load
    installationId = 'unknown';
    isInitialized = true;
  }
}

/**
 * Returns common telemetry attributes synchronously.
 * Note: Some attributes like installation ID might be missing if 
 * initializeCommonAttributes() hasn't completed yet.
 */
export function getCommonAttributes(config: Config): Attributes {
  const email = userAccountManager.getCachedGoogleAccount();
  const experiments = config.getExperiments();
  const authType = config.getContentGeneratorConfig()?.authType;

  return {
    'session.id': config.getSessionId(),
    ...(installationId && { 'installation.id': installationId }),
    interactive: config.isInteractive(),
    ...(email && { 'user.email': email }),
    ...(authType && { auth_type: authType }),
    ...(experiments &&
      experiments.experimentIds.length > 0 && {
        'experiments.ids': experiments.experimentIds,
      }),
  };
}
