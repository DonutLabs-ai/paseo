const { readFileSync } = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const officialConfigPath = path.join(__dirname, "electron-builder.yml");
const parsedOfficialConfig = yaml.load(readFileSync(officialConfigPath, "utf8"));
if (!isRecord(parsedOfficialConfig)) {
  throw new Error("Official electron-builder configuration must be an object");
}

const officialExtraMetadata = isRecord(parsedOfficialConfig.extraMetadata)
  ? parsedOfficialConfig.extraMetadata
  : {};
const officialDirectories = isRecord(parsedOfficialConfig.directories)
  ? parsedOfficialConfig.directories
  : {};
const officialLinux = isRecord(parsedOfficialConfig.linux) ? parsedOfficialConfig.linux : {};
const officialPacman = isRecord(parsedOfficialConfig.pacman) ? parsedOfficialConfig.pacman : {};

module.exports = {
  ...parsedOfficialConfig,
  appId: "io.github.arucil.paseo",
  productName: "Paseo Arucil",
  executableName: "paseo-arucil",
  extraMetadata: {
    ...officialExtraMetadata,
    name: "paseo-arucil",
    productName: "Paseo Arucil",
  },
  // Do not claim the official paseo:// handler. The paseo://app renderer
  // protocol is registered inside each Electron process and is unaffected.
  protocols: [],
  directories: {
    ...officialDirectories,
    output: "release-arucil",
  },
  publish: {
    provider: "github",
    owner: "arucil",
    repo: "paseo",
  },
  linux: {
    ...officialLinux,
    artifactName: "Paseo-Arucil-${version}-${arch}.${ext}",
    maintainer: "arucil <arucil@users.noreply.github.com>",
    vendor: "arucil",
  },
  pacman: {
    ...officialPacman,
    packageName: "paseo-arucil",
  },
};
