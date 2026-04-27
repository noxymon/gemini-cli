/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext } from 'react';
import type {
  StreamingState,
  HistoryItemWithoutId,
  ThoughtSummary,
  ActiveHook,
} from '../types.js';

/**
 * The volatile slice of UI state — these fields change on every stream chunk
 * and are isolated here so that components that only read stable state (history,
 * preferences, dialog flags, …) are NOT re-rendered during streaming.
 *
 * Components that need stable state should continue to use `useUIState()`.
 * Components that only need volatile/streaming data should use `useStreamingContext()`.
 */
export interface StreamingContextValue {
  /** Current streaming state (Idle | Responding | WaitingForConfirmation). */
  streamingState: StreamingState;
  /**
   * Items in-flight from the model that haven't been committed to history yet.
   * Changes on every token during streaming.
   */
  pendingHistoryItems: HistoryItemWithoutId[];
  /** Current thinking/thought summary from the model. */
  thought: ThoughtSummary | null;
  /** Elapsed time since the current streaming turn started (seconds). */
  elapsedTime: number;
  /** Current loading phrase shown in the status row while responding. */
  currentLoadingPhrase: string | undefined;
  /** Current tip shown during loading. */
  currentTip: string | undefined;
  /** Current witty phrase shown during loading. */
  currentWittyPhrase: string | undefined;
  /** Active hooks currently executing. */
  activeHooks: ActiveHook[];
}

export const StreamingContext = createContext<
  StreamingContextValue | undefined
>(undefined);

export const useStreamingContext = (): StreamingContextValue => {
  const context = React.useContext(StreamingContext);
  if (context === undefined) {
    throw new Error(
      'useStreamingContext must be used within a StreamingContextProvider',
    );
  }
  return context;
};

/**
 * Convenience selector for components that only need the raw StreamingState
 * (backward-compatible with the original `useStreamingContext()` return type).
 */
export const useStreamingState = (): StreamingState =>
  useStreamingContext().streamingState;
