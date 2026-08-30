const DEFAULT_DEVELOPMENT_APP_NAME = "Paseo";

export function resolveDesktopAppName(input: {
  isPackaged: boolean;
  packagedName: string;
  override: string | undefined;
}): string {
  const override = input.override?.trim();
  if (override) {
    return override;
  }

  if (!input.isPackaged) {
    return DEFAULT_DEVELOPMENT_APP_NAME;
  }

  const packagedName = input.packagedName.trim();
  if (!packagedName) {
    throw new Error("Packaged desktop application name is empty");
  }
  return packagedName;
}
