import { describe, expect, it } from "vitest";
import { hasWorkspaceReferenceLink } from "./workspace-reference-url.js";

describe("workspace reference link detection", () => {
  it.each([
    "See https://linear.app/donutbrowser/issue/ENG-1234/fix.",
    "https://donutbrowser.slack.com/archives/C123/p1788497156299669?thread_ts=1788493233.086649",
  ])("recognizes a link that the References scanner can load", (text) => {
    expect(hasWorkspaceReferenceLink(text)).toBe(true);
  });

  it.each([
    "No reference in this message",
    "https://linear.app/docs/api-and-webhooks",
    "https://linear.app.evil.test/acme/issue/ENG-1234",
    "http://linear.app/donutbrowser/issue/ENG-1234",
    "https://api.slack.com/apps",
  ])("ignores links that cannot populate References", (text) => {
    expect(hasWorkspaceReferenceLink(text)).toBe(false);
  });
});
