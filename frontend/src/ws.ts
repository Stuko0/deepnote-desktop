/** WebSocket client for the sidecar protocol: reconnect, correlation by id. */

import type { ServerMessage } from './protocol.ts';

export type MessageHandler = (message: ServerMessage) => void;

export interface SidecarConnection {
  send: (type: string, payload?: unknown) => string;
  close: () => void;
  onMessage: (handler: MessageHandler) => void;
  onStatus: (handler: (connected: boolean) => void) => void;
}

export function connectSidecar(url: string, token: string): SidecarConnection {
  let ws: WebSocket | null = null;
  let requestCounter = 0;
  let closedByUser = false;
  let reconnectDelay = 500;
  const messageHandlers: MessageHandler[] = [];
  const statusHandlers: ((connected: boolean) => void)[] = [];
  const queue: string[] = [];

  function notifyStatus(connected: boolean): void {
    for (const handler of statusHandlers) handler(connected);
  }

  function open(): void {
    const wsUrl = `${url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectDelay = 500;
      notifyStatus(true);
      while (queue.length > 0 && ws?.readyState === WebSocket.OPEN) {
        ws.send(queue.shift() as string);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        for (const handler of messageHandlers) handler(message);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      notifyStatus(false);
      if (!closedByUser) {
        setTimeout(open, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
      }
    };

    ws.onerror = () => ws?.close();
  }

  open();

  return {
    send(type: string, payload?: unknown): string {
      requestCounter += 1;
      const id = `req-${requestCounter}`;
      const frame = JSON.stringify({ v: 1, id, type, payload });
      if (ws?.readyState === WebSocket.OPEN) ws.send(frame);
      else queue.push(frame);
      return id;
    },
    close(): void {
      closedByUser = true;
      ws?.close();
    },
    onMessage(handler: MessageHandler): void {
      messageHandlers.push(handler);
    },
    onStatus(handler: (connected: boolean) => void): void {
      statusHandlers.push(handler);
    },
  };
}
