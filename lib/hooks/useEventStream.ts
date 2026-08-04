"use client";

import { useEffect, useRef, useState } from "react";

export type EventStreamStatus = "connecting" | "open";

type EventStreamHandlers<TEvent> = {
  /** Fires on the initial connect AND every auto-reconnect — always
   * re-fetch current state via REST here, since a reconnected EventSource
   * does not replay events it missed while down. */
  onOpen?: () => void;
  onMessage?: (event: TEvent) => void;
};

/**
 * Wraps EventSource for a given SSE endpoint. Handlers are invoked directly
 * from EventSource's own callbacks (not from a React effect reacting to
 * state), so callers can safely trigger fetches/setState from them.
 */
export function useEventStream<TEvent = unknown>(
  url: string,
  handlers: EventStreamHandlers<TEvent>,
) {
  const [status, setStatus] = useState<EventStreamStatus>("connecting");
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const source = new EventSource(url);

    source.onopen = () => {
      setStatus("open");
      handlersRef.current.onOpen?.();
    };
    source.onerror = () => {
      // EventSource retries on its own; just reflect that we're not connected.
      setStatus("connecting");
    };
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TEvent;
        handlersRef.current.onMessage?.(parsed);
      } catch {
        // malformed payload — ignore rather than crash the stream handler
      }
    };

    return () => {
      source.close();
    };
  }, [url]);

  return { status };
}
