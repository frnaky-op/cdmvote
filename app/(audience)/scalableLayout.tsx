"use client";

import React, { useSyncExternalStore, type ReactNode } from 'react';
import {useFullscreen} from '../hooks/useFullScreenHooks'; // Import the hook

interface ScalableLayoutProps {
  children: ReactNode;
  baseWidth?: number;
  baseHeight?: number;
  background?: string
}

function subscribeToResize(onResize: () => void) {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

const ScalableLayout: React.FC<ScalableLayoutProps> = ({
  children,
  baseWidth = 1080,
  baseHeight = 1920,
  background = "#000"
}) => {
  const { handleDoubleTap, handleDoubleClick } = useFullscreen();

  // Scale is derived from the viewport, an external store — subscribing this
  // way (rather than an effect that calls setState) keeps the resize handler
  // itself as the only place state changes, and gives a safe server snapshot
  // for the initial SSR render.
  const scale = useSyncExternalStore(
    subscribeToResize,
    () => Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight),
    () => 1,
  );

  return (
    <div style={{
        display: 'flex',
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh', 
        width: '100vw',
        background,
    }}
    onTouchEnd={handleDoubleTap}
    onDoubleClick={handleDoubleClick}
    >
        <div
        style={{
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            aspectRatio: baseWidth+"/"+baseHeight
        }}
        className='big-screen'
        >
        {children}
        </div>
    </div>
  );
};

export default ScalableLayout;