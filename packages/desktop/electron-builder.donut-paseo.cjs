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
const officialAsarUnpack = Array.isArray(parsedOfficialConfig.asarUnpack)
  ? parsedOfficialConfig.asarUnpack
  : [];
const officialExtraResources = Array.isArray(parsedOfficialConfig.extraResources)
  ? parsedOfficialConfig.extraResources
  : [];
const officialLinux = isRecord(parsedOfficialConfig.linux) ? parsedOfficialConfig.linux : {};
const officialPacman = isRecord(parsedOfficialConfig.pacman) ? parsedOfficialConfig.pacman : {};
const nodeRuntimeName = process.platform === "win32" ? "node.exe" : "node";

module.exports = {
  ...parsedOfficialConfig,
  appId: "ai.donutlabs.paseo",
  productName: "Donut Paseo",
  executableName: "donut-paseo",
  extraMetadata: {
    ...officialExtraMetadata,
    name: "donut-paseo",
    productName: "Donut Paseo",
  },
  // Do not claim the official paseo:// handler. The paseo://app renderer
  // protocol is registered inside each Electron process and is unaffected.
  protocols: [],
  directories: {
    ...officialDirectories,
    output: "release-donut-paseo",
  },
  asarUnpack: [...new Set([...officialAsarUnpack, "node_modules/**/*"])],
  extraResources: [
    ...officialExtraResources,
    {
      from: process.execPath,
      to: `node-runtime/${nodeRuntimeName}`,
    },
  ],
  publish: {
    provider: "github",
    owner: "DonutLabs-ai",
    repo: "paseo",
  },
  linux: {
    ...officialLinux,
    artifactName: "Donut-Paseo-${version}-${arch}.${ext}",
    maintainer: "Donut Labs",
    vendor: "Donut Labs",
  },
  pacman: {
    ...officialPacman,
    packageName: "donut-paseo",
  },
};
