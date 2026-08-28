import type { DeveloperTokenSummary } from "@curve-ai/platform-client";

export type CreateDeveloperTokenActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      secret: string;
      token: DeveloperTokenSummary;
    };

export type RevokeDeveloperTokenActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export type UpdateOrganizationMemberActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };
