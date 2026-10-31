// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS configuration.
const fs = require("node:fs");
const base = {
  appId: "ai.curve.radius",
  productName: "Radius",
  asar: true,
  files: ["out/**", "package.json"],
  mac: {
    category: "public.app-category.productivity",
    target: ["dmg", "zip"],
    // The zip is what the radius CLI installs; release-manifest.ts relies on
    // these names.
    artifactName: "radius-${version}-mac-${arch}.${ext}",
    minimumSystemVersion: "26.0.0",
    // build.sh signs the runtime host with its virtualization entitlement.
    // Re-signing it with the app's entitlements would drop that.
    signIgnore: ["/runtime/macos-arm64/radius-runtime-host$"],
    extraResources: [
      {
        from: "../runtime-host-macos/.build/release/radius-runtime-host",
        to: "runtime/macos-arm64/radius-runtime-host",
      },
      {
        from: "../runtime-host-macos/Config/runtime-assets.json",
        to: "runtime/runtime-assets.json",
      },
      {
        from: "../runtime-host-macos/.build/runtime-assets/vmlinux-arm64",
        to: "runtime/vmlinux-arm64",
      },
      {
        from: "../runtime-host-macos/.build/provider-assets",
        to: "agents",
      },
    ],
  },
  win: {
    executableName: "radius",
    extraResources: [
      {
        from: "../runtime-host-windows/.build/release/radius-runtime-host.exe",
        to: "runtime/windows-x64/radius-runtime-host.exe",
      },
      {
        from: "../runtime-host-windows/.build/release/openvmm.exe",
        to: "runtime/windows-x64/openvmm.exe",
      },
      {
        from: "../runtime-host-windows/Config/runtime-assets.json",
        to: "runtime/runtime-assets.json",
      },
      {
        from: "../runtime-host-windows/.build/runtime-assets/vmlinux-x64",
        to: "runtime/vmlinux-x64",
      },
      {
        from: "../runtime-host-windows/.build/provider-assets",
        to: "agents",
      },
    ],
    // nsis is the installer for people; the zip is the unpacked app the
    // radius CLI installs without an installer UI.
    target: ["nsis", "zip"],
    artifactName: "radius-${version}-win-${arch}.${ext}",
  },
  linux: {
    category: "Utility",
    target: ["AppImage", "deb"],
  },
  nsis: {
    artifactName: "radius-${version}-setup.${ext}",
    shortcutName: "Radius",
    uninstallDisplayName: "Radius",
  },
  dmg: {
    artifactName: "radius-${version}.${ext}",
  },
  appImage: {
    artifactName: "radius-${version}-linux-${arch}.${ext}",
  },
  npmRebuild: false,
  publish: [
    {
      provider: "github",
      owner: "curve-ai",
      repo: "radius",
      releaseType: "release",
    },
  ],
  asarUnpack: ["**/*.node"],
  extraResources: [
    {
      from: "../../packages/storage/drizzle",
      to: "storage-migrations",
    },
  ],
};
const filename = process.env.RADIUS_DISTRIBUTION_CONFIG;
const distribution = filename
  ? JSON.parse(fs.readFileSync(filename, "utf8"))
  : null;
if (
  distribution &&
  (!/^[a-z][a-z0-9.-]{2,100}$/.test(distribution.id) ||
    typeof distribution.displayName !== "string" ||
    !distribution.displayName.trim() ||
    distribution.displayName.length > 120)
)
  throw new Error("Invalid desktop distribution identity");
module.exports = {
  ...base,
  ...(distribution
    ? { appId: distribution.id, productName: distribution.displayName }
    : // `radius dev` opens radius://dev-agent/<id>. Distribution builds keep
      // their own profile, which it does not register agents into.
      { protocols: [{ name: "Radius", schemes: ["radius"] }] }),
};
