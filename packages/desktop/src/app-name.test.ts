import { describe, expect, it } from "vitest";
import { resolveDesktopAppName } from "./app-name";

describe("resolveDesktopAppName", () => {
  it("uses the packaged product name so side-by-side distributions stay isolated", () => {
    expect(
      resolveDesktopAppName({
        isPackaged: true,
        packagedName: "Donut Paseo",
        override: undefined,
      }),
    ).toBe("Donut Paseo");
  });

  it("keeps the canonical name for development", () => {
    expect(
      resolveDesktopAppName({
        isPackaged: false,
        packagedName: "@getpaseo/desktop",
        override: undefined,
      }),
    ).toBe("Paseo");
  });

  it("supports the explicit test override", () => {
    expect(
      resolveDesktopAppName({
        isPackaged: true,
        packagedName: "Paseo",
        override: " Paseo Test ",
      }),
    ).toBe("Paseo Test");
  });

  it("rejects an invalid packaged identity", () => {
    expect(() =>
      resolveDesktopAppName({ isPackaged: true, packagedName: " ", override: undefined }),
    ).toThrow("Packaged desktop application name is empty");
  });
});
