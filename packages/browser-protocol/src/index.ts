export const RADIUS_BROWSER_PROTOCOL_VERSION = 1;
export const RADIUS_BROWSER_NATIVE_HOST = "ai.curve.radius.browser";
export const RADIUS_BROWSER_EXTENSION_ID = "cpdjgipkplfjalonlnacjdhhlmdgnmmc";

export type BrowserBridgeOperation =
  | "browser.status"
  | "tabs.list"
  | "tabs.create"
  | "tabs.activate"
  | "tabs.close"
  | "page.navigate"
  | "page.snapshot"
  | "page.click"
  | "page.type"
  | "page.key"
  | "page.scroll"
  | "page.screenshot"
  | "control.release";

export interface BrowserTabSummary {
  tabId: string;
  windowId: string;
  title: string;
  url: string;
  active: boolean;
  controlled: boolean;
}

export interface BrowserProfileSummary {
  profileId: string;
  browserName: string;
  enabled: boolean;
}

export interface BrowserBridgeHello {
  type: "hello";
  protocolVersion: typeof RADIUS_BROWSER_PROTOCOL_VERSION;
  profile: BrowserProfileSummary;
}

export interface BrowserBridgeRequest {
  type: "request";
  id: string;
  operation: BrowserBridgeOperation;
  input: Record<string, unknown>;
}

export interface BrowserBridgeResponse {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BrowserBridgeEvent {
  type: "event";
  event: "profile.changed" | "tab.changed" | "tab.closed" | "control.released";
  data: Record<string, unknown>;
}

export type BrowserExtensionMessage =
  BrowserBridgeHello | BrowserBridgeResponse | BrowserBridgeEvent;

export type BrowserHostMessage = BrowserBridgeRequest;

export function isBrowserBridgeHello(
  value: unknown,
): value is BrowserBridgeHello {
  if (!isRecord(value) || value.type !== "hello") return false;
  if (value.protocolVersion !== RADIUS_BROWSER_PROTOCOL_VERSION) return false;
  const profile = value.profile;
  return (
    isRecord(profile) &&
    typeof profile.profileId === "string" &&
    profile.profileId.length > 0 &&
    typeof profile.browserName === "string" &&
    profile.browserName.length > 0 &&
    typeof profile.enabled === "boolean"
  );
}

export function isBrowserBridgeResponse(
  value: unknown,
): value is BrowserBridgeResponse {
  return (
    isRecord(value) &&
    value.type === "response" &&
    typeof value.id === "string" &&
    typeof value.ok === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

export function isBrowserBridgeEvent(
  value: unknown,
): value is BrowserBridgeEvent {
  return (
    isRecord(value) &&
    value.type === "event" &&
    [
      "profile.changed",
      "tab.changed",
      "tab.closed",
      "control.released",
    ].includes(String(value.event)) &&
    isRecord(value.data)
  );
}

export function isBrowserBridgeRequest(
  value: unknown,
): value is BrowserBridgeRequest {
  return (
    isRecord(value) &&
    value.type === "request" &&
    typeof value.id === "string" &&
    isBrowserBridgeOperation(value.operation) &&
    isRecord(value.input)
  );
}

export function isBrowserBridgeOperation(
  value: unknown,
): value is BrowserBridgeOperation {
  return (
    typeof value === "string" &&
    [
      "browser.status",
      "tabs.list",
      "tabs.create",
      "tabs.activate",
      "tabs.close",
      "page.navigate",
      "page.snapshot",
      "page.click",
      "page.type",
      "page.key",
      "page.scroll",
      "page.screenshot",
      "control.release",
    ].includes(value)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
