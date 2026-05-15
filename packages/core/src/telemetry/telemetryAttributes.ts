/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attributes } from '@opentelemetry/api';
import type { Config } from '../config/config.js';
import { UserAccountManager } from '../utils/userAccountManager.js';

const userAccountManager = new UserAccountManager();
let installationManager:
  | import('../utils/installationManager.js').InstallationManager
  | undefined = undefined;

export async function getCommonAttributes(config: Config): Promise<Attributes> {
  const email = userAccountManager.getCachedGoogleAccount();
  const experiments = config.getExperiments();
  const authType = config.getContentGeneratorConfig()?.authType;

  if (!installationManager) {
    const { InstallationManager } = await import(
      '../utils/installationManager.js'
    );
    installationManager = new InstallationManager();
  }

  return {
    'session.id': config.getSessionId(),
    'installation.id': installationManager.getInstallationId(),
    interactive: config.isInteractive(),
    ...(email && { 'user.email': email }),
    ...(authType && { auth_type: authType }),
    ...(experiments &&
      experiments.experimentIds.length > 0 && {
        'experiments.ids': experiments.experimentIds,
      }),
  };
}
