import {
  isBrowserBridgeRequest,
  RADIUS_BROWSER_NATIVE_HOST,
  RADIUS_BROWSER_PROTOCOL_VERSION,
  type BrowserBridgeRequest,
  type BrowserBridgeResponse,
  type BrowserTabSummary,
} from "@curve-ai/radius-browser-protocol";

const PROFILE_ID_KEY = "radiusBrowserProfileId";
const ENABLED_KEY = "radiusBrowserEnabled";
const MAX_SNAPSHOT_NODES = 1_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

interface ControlledTab {
  revision: number;
  refs: Map<string, number>;
}

interface AxValue {
  value?: unknown;
}

interface AxNode {
  nodeId?: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  description?: AxValue;
  properties?: Array<{ name?: string; value?: AxValue }>;
}

const controlledTabs = new Map<number, ControlledTab>();
let nativePort: chrome.runtime.Port | null = null;
let nativeConnectionError: string | null = null;
let profileId = "";
let enabled = true;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

void initialize();

async function initialize(): Promise<void> {
  const stored = await chrome.storage.local.get([PROFILE_ID_KEY, ENABLED_KEY]);
  profileId =
    typeof stored[PROFILE_ID_KEY] === "string"
      ? stored[PROFILE_ID_KEY]
      : crypto.randomUUID();
  enabled = stored[ENABLED_KEY] !== false;
  await chrome.storage.local.set({
    [PROFILE_ID_KEY]: profileId,
    [ENABLED_KEY]: enabled,
  });
  if (enabled) connectNativeHost();
}

function connectNativeHost(): void {
  if (!enabled || nativePort) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    const port = chrome.runtime.connectNative(RADIUS_BROWSER_NATIVE_HOST);
    nativePort = port;
    nativeConnectionError = null;
    port.onMessage.addListener((message: unknown) => {
      void handleHostMessage(message);
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (nativePort === port) nativePort = null;
      nativeConnectionError = error || "RADIUS_BROWSER_HOST_DISCONNECTED";
      scheduleReconnect();
    });
    port.postMessage({
      type: "hello",
      protocolVersion: RADIUS_BROWSER_PROTOCOL_VERSION,
      profile: {
        profileId,
        browserName: navigator.userAgent.includes("Edg/") ? "Edge" : "Chrome",
        enabled,
      },
    });
  } catch (error) {
    nativeConnectionError = errorMessage(error);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNativeHost();
  }, 2_000);
}

async function handleHostMessage(message: unknown): Promise<void> {
  if (!isBrowserBridgeRequest(message)) return;
  let response: BrowserBridgeResponse;
  if (!enabled) {
    response = {
      type: "response",
      id: message.id,
      ok: false,
      error: "BROWSER_ACCESS_PAUSED",
    };
  } else {
    try {
      response = {
        type: "response",
        id: message.id,
        ok: true,
        result: await executeRequest(message),
      };
    } catch (error) {
      response = {
        type: "response",
        id: message.id,
        ok: false,
        error: errorMessage(error).slice(0, 500),
      };
    }
  }
  nativePort?.postMessage(response);
}

async function executeRequest(request: BrowserBridgeRequest): Promise<unknown> {
  switch (request.operation) {
    case "browser.status":
      return popupStatus();
    case "tabs.list":
      return { tabs: await listTabs() };
    case "tabs.create":
      return createTab(request.input);
    case "tabs.activate":
      return activateTab(request.input);
    case "tabs.close":
      return closeTab(request.input);
    case "page.navigate":
      return navigatePage(request.input);
    case "page.snapshot":
      return snapshotPage(request.input);
    case "page.click":
      return clickPage(request.input);
    case "page.type":
      return typePage(request.input);
    case "page.key":
      return pressKey(request.input);
    case "page.scroll":
      return scrollPage(request.input);
    case "page.screenshot":
      return screenshotPage(request.input);
    case "control.release":
      return releaseControl(request.input);
  }
}

async function listTabs(): Promise<BrowserTabSummary[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.flatMap((tab) => {
    if (tab.id === undefined || tab.windowId === undefined || tab.incognito)
      return [];
    const url = tab.url || "";
    if (url && !isAllowedPageUrl(url)) return [];
    return [
      {
        tabId: encodeTabId(tab.id),
        windowId: String(tab.windowId),
        title: boundedText(tab.title || "Untitled tab", 240),
        url: boundedText(url || "about:blank", 2_048),
        active: tab.active,
        controlled: controlledTabs.has(tab.id),
      },
    ];
  });
}

async function createTab(input: Record<string, unknown>): Promise<unknown> {
  const url = optionalUrl(input.url);
  const tab = await chrome.tabs.create({
    ...(url ? { url } : {}),
    active: input.active === true,
  });
  if (tab.id === undefined) throw new Error("BROWSER_TAB_CREATE_FAILED");
  return { tab: await summarizeTab(tab.id) };
}

async function activateTab(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return { tab: await summarizeTab(tabId) };
}

async function closeTab(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  await detachTab(tabId);
  await chrome.tabs.remove(tabId);
  return { closed: true };
}

async function navigatePage(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const url = requiredUrl(input.url);
  await ensureAttached(tabId);
  await chrome.tabs.update(tabId, { url });
  return { tab: await waitForTabReady(tabId) };
}

async function snapshotPage(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const state = await ensureAttached(tabId);
  const response = (await cdp(tabId, "Accessibility.getFullAXTree", {
    depth: 24,
  })) as { nodes?: AxNode[] };
  const nodes = response.nodes || [];
  state.revision += 1;
  state.refs.clear();
  const byId = new Map(
    nodes.flatMap((node) =>
      node.nodeId ? [[node.nodeId, node] as const] : [],
    ),
  );
  const roots = nodes.filter(
    (node) => !node.parentId || !byId.has(node.parentId),
  );
  const lines: string[] = [];
  let refIndex = 0;
  const visit = (node: AxNode, depth: number): void => {
    if (lines.length >= MAX_SNAPSHOT_NODES || node.ignored) return;
    const role = axText(node.role) || "generic";
    const name = axText(node.name);
    const value = axText(node.value);
    const description = axText(node.description);
    const meaningful =
      name || value || description || role !== "generic" || depth === 0;
    let ref = "";
    if (meaningful && Number.isInteger(node.backendDOMNodeId)) {
      refIndex += 1;
      ref = `r${state.revision}e${refIndex}`;
      state.refs.set(ref, node.backendDOMNodeId as number);
    }
    if (meaningful) {
      const details = [
        name ? JSON.stringify(boundedText(name, 300)) : "",
        value ? `value=${JSON.stringify(boundedText(value, 300))}` : "",
        description
          ? `description=${JSON.stringify(boundedText(description, 300))}`
          : "",
        ref ? `[ref=${ref}]` : "",
      ].filter(Boolean);
      lines.push(
        `${"  ".repeat(Math.min(depth, 16))}- ${role}${
          details.length ? ` ${details.join(" ")}` : ""
        }`,
      );
    }
    for (const childId of node.childIds || []) {
      const child = byId.get(childId);
      if (child) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  const tab = await summarizeTab(tabId);
  return {
    tab,
    revision: state.revision,
    snapshot: lines.join("\n").slice(0, 256 * 1024),
    truncated: lines.length >= MAX_SNAPSHOT_NODES,
  };
}

async function clickPage(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const point = await targetPoint(tabId, input);
  await moveAgentCursor(tabId, point.x, point.y, true);
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  return { clicked: point, tab: await summarizeTab(tabId) };
}

async function typePage(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const ref = requiredString(
    input.ref,
    "A current element reference is required",
  );
  const text = requiredString(input.text, "Text is required", 100_000);
  const backendNodeId = resolveRef(tabId, ref);
  const point = await pointForNode(tabId, backendNodeId);
  await moveAgentCursor(tabId, point.x, point.y, false);
  await cdp(tabId, "DOM.focus", { backendNodeId });
  const resolved = (await cdp(tabId, "DOM.resolveNode", {
    backendNodeId,
  })) as { object?: { objectId?: string } };
  const objectId = resolved.object?.objectId;
  if (objectId) {
    await cdp(tabId, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration:
        "function(){if('value' in this){this.value='';this.dispatchEvent(new Event('input',{bubbles:true}));}else if(this.isContentEditable){this.textContent='';}}",
      returnByValue: true,
    });
  }
  await cdp(tabId, "Input.insertText", { text });
  if (input.submit === true) await dispatchKey(tabId, "Enter");
  return { typed: true, tab: await summarizeTab(tabId) };
}

async function pressKey(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  const key = requiredString(input.key, "A key is required", 40);
  await ensureAttached(tabId);
  await dispatchKey(tabId, key);
  return { pressed: key, tab: await summarizeTab(tabId) };
}

async function scrollPage(input: Record<string, unknown>): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  await ensureAttached(tabId);
  const deltaX = boundedNumber(input.deltaX, -10_000, 10_000, 0);
  const deltaY = boundedNumber(input.deltaY, -10_000, 10_000, 0);
  const x = boundedNumber(input.x, 0, 10_000, 400);
  const y = boundedNumber(input.y, 0, 10_000, 300);
  await moveAgentCursor(tabId, x, y, false);
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
  });
  return { scrolled: true, tab: await summarizeTab(tabId) };
}

async function screenshotPage(
  input: Record<string, unknown>,
): Promise<unknown> {
  const tabId = requiredTabId(input.tabId);
  await ensureAttached(tabId);
  const result = (await cdp(tabId, "Page.captureScreenshot", {
    format: "jpeg",
    quality: 72,
    fromSurface: true,
    captureBeyondViewport: false,
  })) as { data?: string };
  if (!result.data) throw new Error("BROWSER_SCREENSHOT_FAILED");
  if (result.data.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3)) {
    throw new Error("BROWSER_SCREENSHOT_TOO_LARGE");
  }
  return {
    tab: await summarizeTab(tabId),
    mediaType: "image/jpeg",
    data: result.data,
  };
}

async function releaseControl(
  input: Record<string, unknown>,
): Promise<unknown> {
  if (input.tabId === undefined) {
    await detachAllTabs();
  } else {
    await detachTab(requiredTabId(input.tabId));
  }
  return { released: true };
}

async function ensureAttached(tabId: number): Promise<ControlledTab> {
  const existing = controlledTabs.get(tabId);
  if (existing) return existing;
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito || (tab.url && !isAllowedPageUrl(tab.url))) {
    throw new Error("BROWSER_TAB_NOT_CONTROLLABLE");
  }
  await chrome.debugger.attach({ tabId }, "1.3");
  await Promise.all([
    cdp(tabId, "Page.enable"),
    cdp(tabId, "DOM.enable"),
    cdp(tabId, "Accessibility.enable"),
    cdp(tabId, "Runtime.enable"),
  ]);
  const state = { revision: 0, refs: new Map<string, number>() };
  controlledTabs.set(tabId, state);
  await chrome.action.setBadgeText({ tabId, text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#4b5563" });
  sendEvent("tab.changed", { tabId: encodeTabId(tabId), controlled: true });
  return state;
}

async function detachTab(tabId: number): Promise<void> {
  if (!controlledTabs.has(tabId)) return;
  controlledTabs.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  sendEvent("control.released", { tabId: encodeTabId(tabId) });
}

async function detachAllTabs(): Promise<void> {
  await Promise.all([...controlledTabs.keys()].map(detachTab));
}

async function summarizeTab(tabId: number): Promise<BrowserTabSummary> {
  const tab = await chrome.tabs.get(tabId);
  return {
    tabId: encodeTabId(tabId),
    windowId: String(tab.windowId),
    title: boundedText(tab.title || "Untitled tab", 240),
    url: boundedText(tab.url || "about:blank", 2_048),
    active: tab.active,
    controlled: controlledTabs.has(tabId),
  };
}

async function waitForTabReady(tabId: number): Promise<BrowserTabSummary> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return summarizeTab(tabId);
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, 15_000);
    function done(): void {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(
      updatedId: number,
      change: chrome.tabs.OnUpdatedInfo,
    ): void {
      if (updatedId === tabId && change.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  return summarizeTab(tabId);
}

async function targetPoint(
  tabId: number,
  input: Record<string, unknown>,
): Promise<{ x: number; y: number }> {
  if (typeof input.ref === "string") {
    return pointForNode(tabId, resolveRef(tabId, input.ref));
  }
  return {
    x: boundedNumber(input.x, 0, 100_000, NaN),
    y: boundedNumber(input.y, 0, 100_000, NaN),
  };
}

function resolveRef(tabId: number, ref: string): number {
  const backendNodeId = controlledTabs.get(tabId)?.refs.get(ref);
  if (!backendNodeId) {
    throw new Error("BROWSER_ELEMENT_REFERENCE_STALE");
  }
  return backendNodeId;
}

async function pointForNode(
  tabId: number,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  const result = (await cdp(tabId, "DOM.getBoxModel", {
    backendNodeId,
  })) as { model?: { content?: number[]; border?: number[] } };
  const quad = result.model?.content || result.model?.border;
  if (!quad || quad.length < 8) throw new Error("BROWSER_ELEMENT_NOT_VISIBLE");
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}

async function moveAgentCursor(
  tabId: number,
  x: number,
  y: number,
  click: boolean,
): Promise<void> {
  const expression = `(() => {
    const id = "__radius_agent_cursor__";
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.setAttribute("aria-hidden", "true");
      root.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate3d(0,0,0);transition:transform 120ms cubic-bezier(.2,.8,.2,1);contain:layout style paint;";
      const pointer = document.createElement("span");
      pointer.style.cssText = "display:block;width:13px;height:18px;background:#f7f7f5;border:1px solid #252525;clip-path:polygon(0 0,100% 68%,58% 72%,40% 100%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.24));";
      const label = document.createElement("span");
      label.textContent = "Radius";
      label.style.cssText = "display:block;width:max-content;margin:1px 0 0 10px;padding:2px 5px;border-radius:4px;background:#252525;color:#f7f7f5;font:11px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;";
      root.append(pointer, label);
      document.documentElement.appendChild(root);
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) root.style.transition = "none";
    root.style.transform = "translate3d(${Math.round(x)}px,${Math.round(y)}px,0)";
    if (${click ? "true" : "false"}) {
      root.animate([{opacity:1},{opacity:.45},{opacity:1}], {duration:160});
    }
  })()`;
  await cdp(tabId, "Runtime.evaluate", {
    expression,
    includeCommandLineAPI: false,
    returnByValue: true,
  }).catch(() => undefined);
}

async function dispatchKey(tabId: number, key: string): Promise<void> {
  const normalized = key.trim();
  const supported = new Set([
    "Enter",
    "Tab",
    "Escape",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]);
  if (!supported.has(normalized)) {
    if (normalized.length === 1) {
      await cdp(tabId, "Input.insertText", { text: normalized });
      return;
    }
    throw new Error("BROWSER_KEY_UNSUPPORTED");
  }
  await cdp(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: normalized,
  });
  await cdp(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: normalized,
  });
}

function cdp(
  tabId: number,
  method: string,
  commandParams?: Record<string, unknown>,
): Promise<unknown> {
  return chrome.debugger.sendCommand({ tabId }, method, commandParams);
}

function requiredTabId(value: unknown): number {
  if (typeof value !== "string" || !/^tab-\d+$/.test(value)) {
    throw new Error("BROWSER_TAB_ID_INVALID");
  }
  return Number(value.slice(4));
}

function encodeTabId(tabId: number): string {
  return `tab-${tabId}`;
}

function requiredString(
  value: unknown,
  message: string,
  maxLength = 2_048,
): string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new Error(message);
  }
  return value;
}

function requiredUrl(value: unknown): string {
  return safeUrl(requiredString(value, "A URL is required", 8_192));
}

function optionalUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return safeUrl(requiredString(value, "The URL is invalid", 8_192));
}

function safeUrl(value: string): string {
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  const url = new URL(normalized);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BROWSER_URL_SCHEME_BLOCKED");
  }
  if (url.username || url.password) {
    throw new Error("BROWSER_URL_CREDENTIALS_BLOCKED");
  }
  return url.toString();
}

function isAllowedPageUrl(value: string): boolean {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = typeof value === "number" ? value : fallback;
  if (!Number.isFinite(number)) throw new Error("BROWSER_COORDINATE_INVALID");
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function axText(value: AxValue | undefined): string {
  const raw = value?.value;
  return typeof raw === "string" || typeof raw === "number"
    ? String(raw).trim()
    : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendEvent(
  event: "profile.changed" | "tab.changed" | "tab.closed" | "control.released",
  data: Record<string, unknown>,
): void {
  nativePort?.postMessage({ type: "event", event, data });
}

function popupStatus() {
  return {
    connected: nativePort !== null,
    enabled,
    controlledTabs: controlledTabs.size,
    error: nativeConnectionError,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "popup.status") {
    sendResponse(popupStatus());
    return false;
  }
  if (message?.type === "popup.toggle") {
    void (async () => {
      enabled = !enabled;
      await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
      if (enabled) {
        connectNativeHost();
      } else {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        nativePort?.disconnect();
        nativePort = null;
        await detachAllTabs();
      }
      sendEvent("profile.changed", { enabled });
      sendResponse(popupStatus());
    })();
    return true;
  }
  return false;
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return;
  controlledTabs.delete(source.tabId);
  void chrome.action.setBadgeText({ tabId: source.tabId, text: "" });
  sendEvent("control.released", { tabId: encodeTabId(source.tabId) });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!controlledTabs.has(tabId)) return;
  if (changeInfo.status === "loading") {
    const state = controlledTabs.get(tabId);
    if (state) {
      state.revision += 1;
      state.refs.clear();
    }
  }
  sendEvent("tab.changed", {
    tabId: encodeTabId(tabId),
    ...(changeInfo.url ? { url: boundedText(changeInfo.url, 2_048) } : {}),
    ...(changeInfo.status ? { status: changeInfo.status } : {}),
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  controlledTabs.delete(tabId);
  sendEvent("tab.closed", { tabId: encodeTabId(tabId) });
});
