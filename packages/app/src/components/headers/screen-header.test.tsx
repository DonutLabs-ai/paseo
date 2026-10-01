import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { ScreenHeader } from "./screen-header";

const navigation = vi.hoisted(() => ({ isFocused: true }));

vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => navigation.isFocused,
}));

vi.mock("react-native", () => ({ View: "div" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0 }),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: object) => object) =>
      factory({
        spacing: { 2: 8, 3: 12 },
        borderWidth: { 1: 1 },
        colors: { surface0: "#111", border: "#333" },
      }),
  },
  useUnistyles: () => ({ theme: { spacing: { 2: 8, 3: 12 } } }),
}));
vi.mock("@/composer/dock", () => ({ ComposerDockBackground: "div" }));
vi.mock("@/utils/desktop-window", () => ({ WindowChromeSafeArea: "div" }));
vi.mock("@/components/desktop/titlebar-drag-region", () => ({ TitlebarDragRegion: "div" }));
vi.mock("@/constants/layout", () => ({
  HEADER_INNER_HEIGHT: 36,
  HEADER_INNER_HEIGHT_MOBILE: 44,
  HEADER_TOP_PADDING_MOBILE: 0,
  useIsCompactFormFactor: () => false,
}));
vi.mock("@/components/utility-tray", async () => {
  const { createElement } = await import("react");
  return {
    UtilityTrayTrigger: () =>
      createElement(
        "button",
        { "data-testid": "utility-tray-trigger", type: "button" },
        "Terminal",
      ),
  };
});

describe("ScreenHeader", () => {
  it("places the utility terminal immediately left of Open Cockpit", () => {
    vi.stubGlobal("React", React);
    const right = React.createElement(
      "button",
      { "data-testid": "open-cockpit", type: "button" },
      "Open Cockpit",
    );
    const html = renderToStaticMarkup(<ScreenHeader right={right} />);
    const document = new JSDOM(html).window.document;
    const utilityTrigger = document.querySelector('[data-testid="utility-tray-trigger"]');

    expect(utilityTrigger?.nextElementSibling?.getAttribute("data-testid")).toBe("open-cockpit");
    expect(utilityTrigger?.parentElement?.children).toHaveLength(2);
  });

  it("does not duplicate the utility terminal trigger in a retained, unfocused route", () => {
    vi.stubGlobal("React", React);
    navigation.isFocused = false;
    const retainedHeader = renderToStaticMarkup(<ScreenHeader />);
    navigation.isFocused = true;
    const activeHeader = renderToStaticMarkup(<ScreenHeader />);
    const document = new JSDOM(`${retainedHeader}${activeHeader}`).window.document;

    expect(document.querySelectorAll('[data-testid="utility-tray-trigger"]')).toHaveLength(1);
  });
});
