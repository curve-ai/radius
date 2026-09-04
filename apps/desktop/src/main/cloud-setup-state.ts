import { validatedPlatformUrl } from "./platform-endpoint";

/**
 * Curve Cloud signs people in on one shared address and then runs each
 * organization's platform on its own host. This turns "signed in to Curve
 * Cloud" into "the base URL of your workspace", so the user never has to know
 * or type their slug.
 *
 * Kept free of Electron so the state machine can be tested directly.
 */

export interface CloudWorkspace {
  slug: string;
  displayName: string;
  baseUrl: string;
}

/** Values `cloud_hosting.lifecycle_state` can hold. Only one means usable. */
const READY = "ready";
const TERMINAL_FAILURES = new Set(["failed", "suspended", "closed"]);

/**
 * Cloud replaces the leading hostname label: `app.curvehq.sh` becomes
 * `northwind.curvehq.sh`, and `app.localhost:8080` becomes
 * `northwind.localhost:8080`. Used only when the API does not report a URL
 * of its own.
 */
export function organizationBaseUrl(
  cloudUrl: string,
  hostnameLabel: string,
): string {
  const cloud = validatedPlatformUrl(cloudUrl);
  const labels = cloud.hostname.split(".");
  if (labels.length < 2) return cloud.toString();
  const organization = new URL(cloud.toString());
  organization.hostname = [hostnameLabel, ...labels.slice(1)].join(".");
  return organization.toString();
}

interface CurrentOrganizationResponse {
  organization: {
    slug?: unknown;
    name?: unknown;
    hostnameLabel?: unknown;
    lifecycleState?: unknown;
    url?: unknown;
  } | null;
}

export type SetupState =
  | { status: "signed-out" }
  | { status: "no-organization" }
  | { status: "provisioning" }
  | { status: "failed"; lifecycleState: string }
  | { status: "ready"; workspace: CloudWorkspace };

/**
 * Reads the active organization and how far its platform has come. Kept
 * separate from the window loop so the state machine can be tested without
 * Electron.
 */
export async function readCloudSetupState(
  cloudUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<SetupState> {
  let response: Response;
  try {
    response = await fetchImpl(
      new URL(
        "api/organizations/current",
        validatedPlatformUrl(cloudUrl),
      ).toString(),
      { credentials: "include" },
    );
  } catch {
    return { status: "signed-out" };
  }
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) return { status: "signed-out" };

  const body = (await response
    .json()
    .catch(() => null)) as CurrentOrganizationResponse | null;
  const organization = body?.organization;
  if (!organization) return { status: "no-organization" };

  const lifecycleState =
    typeof organization.lifecycleState === "string"
      ? organization.lifecycleState
      : "requested";
  if (TERMINAL_FAILURES.has(lifecycleState)) {
    return { status: "failed", lifecycleState };
  }
  if (lifecycleState !== READY) return { status: "provisioning" };

  const slug = typeof organization.slug === "string" ? organization.slug : null;
  const hostnameLabel =
    typeof organization.hostnameLabel === "string"
      ? organization.hostnameLabel
      : slug;
  if (!slug || !hostnameLabel) return { status: "provisioning" };

  // The API knows the scheme and port its own deployment uses, so prefer its
  // answer and only rebuild the host when it does not say.
  const baseUrl =
    typeof organization.url === "string" && organization.url.length > 0
      ? validatedPlatformUrl(organization.url).toString()
      : organizationBaseUrl(cloudUrl, hostnameLabel);

  return {
    status: "ready",
    workspace: {
      slug,
      displayName:
        typeof organization.name === "string" ? organization.name : slug,
      baseUrl,
    },
  };
}
