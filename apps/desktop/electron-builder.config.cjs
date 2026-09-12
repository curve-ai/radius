// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS configuration.
const fs = require("node:fs");
const packageBuild = JSON.parse(
  fs.readFileSync(`${__dirname}/package.json`, "utf8"),
).build;
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
  extends: "./electron-builder.yml",
  ...packageBuild,
  ...(distribution
    ? { appId: distribution.id, productName: distribution.displayName }
    : {}),
};
