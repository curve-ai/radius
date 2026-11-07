import { buildCommand } from "@stricli/core";

import { commonFlags } from "../../flags.js";

export const pushCommand = buildCommand({
  loader: async () => import("./run.js"),
  parameters: {
    flags: {
      ...commonFlags,
      build: {
        kind: "parsed",
        parse: String,
        brief: "Build digest to upload (default: the latest build)",
        optional: true,
      },
      environment: {
        kind: "parsed",
        parse: String,
        brief: "Environment the version is for",
        default: "production",
      },
      organization: {
        kind: "parsed",
        parse: String,
        brief:
          "Organization slug, if the access token belongs to more than one",
        optional: true,
      },
      config: {
        kind: "parsed",
        parse: String,
        brief: "Path to the agent config, if it is not radius.json",
        optional: true,
      },
      "api-url": {
        kind: "parsed",
        parse: String,
        brief: "Radius Platform address (default: RADIUS_API_URL)",
        optional: true,
      },
      token: {
        kind: "parsed",
        parse: String,
        brief: "Access token (default: RADIUS_ACCESS_TOKEN)",
        optional: true,
      },
    },
  },
  docs: {
    brief:
      "Upload a build to the Radius Platform as a version that is not live",
    fullDescription:
      "Uploads the image from `radius build` through the Radius Platform. The platform hands out registry credentials for this one upload, and the image is sent over HTTPS (plain HTTP only to a registry on this machine).\n\nThe new version appears on the agent's page in the dashboard, where it can be promoted to go live.\n\nThe platform address and access token come from RADIUS_API_URL and RADIUS_ACCESS_TOKEN, or --api-url and --token.",
  },
});
