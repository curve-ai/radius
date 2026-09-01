import { z } from "zod";

const projectRef = z.string().regex(/^proj_[A-Za-z0-9_-]{6,64}$/);
const relativeResourcePath = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\"), {
    message: "Bundled resource paths must be relative",
  })
  .refine((value) => !value.includes("\\"), {
    message: "Bundled resource paths must use POSIX separators",
  })
  .refine(
    (value) => value.split("/").every((segment) => segment && segment !== ".."),
    { message: "Bundled resource paths must not escape their root" },
  );

export const BundledAgentIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    agents: z
      .array(
        z.object({
          project: projectRef,
          imageLayout: relativeResourcePath,
        }),
      )
      .min(1)
      .max(64),
  })
  .superRefine((index, context) => {
    const projects = new Set<string>();
    for (const [position, agent] of index.agents.entries()) {
      if (projects.has(agent.project)) {
        context.addIssue({
          code: "custom",
          path: ["agents", position, "project"],
          message: "Bundled agent projects must be unique",
        });
      }
      projects.add(agent.project);
    }
  });

export type BundledAgentIndex = z.infer<typeof BundledAgentIndexSchema>;

export function parseBundledAgentIndex(input: unknown): BundledAgentIndex {
  return BundledAgentIndexSchema.parse(input);
}
