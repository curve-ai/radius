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
    minimumSystemVersion: "26.0.0",
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
    target: ["nsis"],
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
    artifactName: "radius-${version}.${ext}",
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
    {
      from: "../browser-extension/dist",
      to: "browser-extension",
    },
    {
      from: "../browser-native-host/dist",
      to: "browser-native-host",
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
    : {}),
};
