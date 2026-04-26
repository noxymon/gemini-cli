/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import {
  getConfirmingToolState,
  type ConfirmingToolState,
} from '../utils/confirmingTool.js';

export type { ConfirmingToolState } from '../utils/confirmingTool.js';

/**
 * Selects the "Head" of the confirmation queue.
 * Returns the first tool in the pending state that requires confirmation.
 *
 * H9: Uses StreamingContext instead of UIStateContext so this hook only
 * triggers a re-render when pendingHistoryItems changes, not on every
 * stable-state update.
 */
export function useConfirmingTool(): ConfirmingToolState | null {
  // We use pendingHistoryItems to ensure we capture tools from both
  // Gemini responses and Slash commands.
  const { pendingHistoryItems } = useStreamingContext();

  return useMemo(
    () => getConfirmingToolState(pendingHistoryItems),
    [pendingHistoryItems],
  );
}
