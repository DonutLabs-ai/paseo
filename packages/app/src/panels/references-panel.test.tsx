/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { WorkspaceReference } from "@getpaseo/protocol/messages";
import type { MarkdownRendererProps } from "@/components/markdown/renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const mocks = vi.hoisted(() => ({
  markdownRenderer: vi.fn((_props: MarkdownRendererProps) => null),
  openExternalUrl: vi.fn((_url: string) => Promise.resolve()),
}));

vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: mocks.markdownRenderer,
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

import { ReferenceCard } from "./references-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const reference: WorkspaceReference = {
  key: "linear:PRODUCT-5597",
  provider: "linear",
  url: "https://linear.app/donutbrowser/issue/PRODUCT-5597",
  title: "PRODUCT-5597 Onboarding 2.0",
  summary: "> **Milestone**: render [linked issues](https://linear.app/example) as Markdown.",
  state: "ready",
  error: null,
  fetchedAt: "2026-09-22T15:01:17.000Z",
};

describe("ReferenceCard", () => {
  it("renders fetched descriptions as compact Markdown without HTML-ish extensions", () => {
    render(<ReferenceCard reference={reference} />);

    expect(mocks.markdownRenderer).toHaveBeenCalledOnce();
    expect(mocks.markdownRenderer.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: reference.summary,
        compact: true,
        enableHtmlish: false,
      }),
    );
  });

  it("keeps the source link on the header instead of wrapping the Markdown body", () => {
    const view = render(<ReferenceCard reference={reference} />);

    fireEvent.click(view.getByRole("link"));

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(reference.url);
    expect(view.getByRole("link").contains(view.getByText(reference.title ?? ""))).toBe(true);
  });
});
