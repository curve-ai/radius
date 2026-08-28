interface PopupStatus {
  connected: boolean;
  enabled: boolean;
  controlledTabs: number;
  error: string | null;
}

const connectionState =
  document.querySelector<HTMLElement>("#connection-state");
const controlledTabs = document.querySelector<HTMLElement>("#controlled-tabs");
const statusCopy = document.querySelector<HTMLElement>("#status-copy");
const toggle = document.querySelector<HTMLButtonElement>("#toggle-access");

function render(status: PopupStatus): void {
  if (!connectionState || !controlledTabs || !statusCopy || !toggle) return;
  connectionState.textContent = status.connected
    ? "Connected"
    : "Not connected";
  controlledTabs.textContent = String(status.controlledTabs);
  toggle.disabled = !status.connected && status.enabled;
  toggle.textContent = status.enabled
    ? "Pause browser access"
    : "Turn on browser access";
  statusCopy.textContent = status.error
    ? "Open Radius and try again. Browser access stays off until the local connection is available."
    : status.enabled
      ? "Radius can use tabs in this Chrome profile while browser access is on."
      : "Browser access is paused. Radius cannot inspect or control tabs in this profile.";
}

async function loadStatus(): Promise<void> {
  const status = (await chrome.runtime.sendMessage({
    type: "popup.status",
  })) as PopupStatus;
  render(status);
}

toggle?.addEventListener("click", async () => {
  toggle.disabled = true;
  const status = (await chrome.runtime.sendMessage({
    type: "popup.toggle",
  })) as PopupStatus;
  render(status);
});

void loadStatus();
