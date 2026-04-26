/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useIsScreenReaderEnabled } from 'ink';
import { useUIState } from './contexts/UIStateContext.js';
import { QuittingDisplay } from './components/QuittingDisplay.js';
import { ScreenReaderAppLayout } from './layouts/ScreenReaderAppLayout.js';
import { DefaultAppLayout } from './layouts/DefaultAppLayout.js';
import { AlternateBufferQuittingDisplay } from './components/AlternateBufferQuittingDisplay.js';
import { useAlternateBuffer } from './hooks/useAlternateBuffer.js';

// NOTE: StreamingContext.Provider has been moved to AppContainer.tsx so that
// the volatile streaming slice (pendingHistoryItems, streamingState, thought, …)
// can be memoized independently of the main UIStateContext value.  This prevents
// components that subscribe only to StreamingContext from re-rendering every time
// any other part of UIStateContext changes.

export const App = () => {
  const uiState = useUIState();
  const isAlternateBuffer = useAlternateBuffer();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  if (uiState.quittingMessages) {
    if (isAlternateBuffer) {
      return <AlternateBufferQuittingDisplay />;
    } else {
      return <QuittingDisplay />;
    }
  }

  return isScreenReaderEnabled ? <ScreenReaderAppLayout /> : <DefaultAppLayout />;
};
