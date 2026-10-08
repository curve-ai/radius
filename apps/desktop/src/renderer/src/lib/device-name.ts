/** How copy refers to the computer Radius runs on: "this Mac" on macOS, "this device" elsewhere. */
export function thisDevice(): string {
  return window.radius?.platform === "darwin" ? "this Mac" : "this device";
}
