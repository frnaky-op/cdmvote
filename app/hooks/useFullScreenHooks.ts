"use client";

import { useCallback, useRef } from "react";
import type { TouchEvent } from "react";

const DOUBLE_TAP_THRESHOLD_MS = 300;

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

/**
 * Double-tap (touch) / double-click (mouse) toggles fullscreen — the
 * standard interaction for an unattended, scaled kiosk-style display.
 * touchend fires once per tap, so double-tap has to be detected manually
 * from the gap between consecutive taps; dblclick already does this for us
 * on desktop.
 */
export function useFullscreen() {
  const lastTapAtRef = useRef(0);

  const handleDoubleTap = useCallback((event: TouchEvent) => {
    const now = Date.now();
    if (now - lastTapAtRef.current < DOUBLE_TAP_THRESHOLD_MS) {
      event.preventDefault();
      toggleFullscreen();
      lastTapAtRef.current = 0;
    } else {
      lastTapAtRef.current = now;
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    toggleFullscreen();
  }, []);

  return { handleDoubleTap, handleDoubleClick };
}
