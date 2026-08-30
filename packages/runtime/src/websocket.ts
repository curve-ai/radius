import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import type { Stream } from "@agentclientprotocol/sdk";
import { WebSocket } from "ws";

export function acpStreamFromWebSocket(
  endpoint: string,
  authorization?: string | null,
): Stream {
  return createWebSocketStream(endpoint, {
    WebSocket,
    ...(authorization
      ? { headers: { Authorization: authorization } }
      : undefined),
  });
}
