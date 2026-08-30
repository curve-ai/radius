import path from "node:path";

import { z } from "zod";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const DevelopmentAgentConnectionSchema = z.object({
  schemaVersion: z.literal(1),
  agentId: z.string().regex(/^agent_[A-Za-z0-9_-]{6,64}$/),
  displayName: z.string().trim().min(1).max(120),
  endpoint: z
    .string()
    .url()
    .superRefine((value, context) => {
      const endpoint = new URL(value);
      if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
        context.addIssue({
          code: "custom",
          message: "Development ACP endpoints must use WebSocket",
        });
      }
      if (!loopbackHosts.has(endpoint.hostname)) {
        context.addIssue({
          code: "custom",
          message: "Development ACP endpoints must be loopback-only",
        });
      }
    }),
  authorization: z.string().trim().min(1).nullable().default(null),
  cwd: z.string().trim().min(1).refine(path.isAbsolute, {
    message: "Development agent cwd must be absolute",
  }),
  ownerPid: z.number().int().positive(),
  capabilities: z.array(z.string().trim().min(1)).max(256).default([]),
  registeredAt: z.string().datetime(),
});

export type DevelopmentAgentConnection = z.infer<
  typeof DevelopmentAgentConnectionSchema
>;

export function parseDevelopmentAgentConnection(
  input: unknown,
): DevelopmentAgentConnection {
  return DevelopmentAgentConnectionSchema.parse(input);
}
