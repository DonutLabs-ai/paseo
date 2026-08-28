import { test, expect } from "../support/fixtures";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  seedRunningMockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";

const PROMPT = "Build the cockpit workspace overview";
const REPLY = "Cockpit summary Implemented workspace cards and live progress summaries.";

test("shows the latest agent activity in the sidebar and cockpit cards", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-workspaces-",
    title: "Cockpit workspace",
    initialPrompt: PROMPT,
    featureValues: {
      mockAssistantResponse:
        "## Cockpit summary\n\nImplemented workspace cards and live progress summaries.",
    },
  });

  try {
    await workspace.client.waitForFinish(workspace.agentId, 15_000);
    await openAgentRoute(page, workspace);

    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    await expect(page.getByTestId(`sidebar-workspace-summary-${workspaceKey}`).first()).toHaveText(
      REPLY,
      { timeout: 30_000 },
    );

    await page.getByTestId("cockpit-mode-toggle").click();
    await expect(page).toHaveURL(/\/cockpit$/);

    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(REPLY);
    await expect(card).toContainText(PROMPT);

    await card.click();
    await expect(page).toHaveURL(/\/workspace\//);
    await expect(page.getByText("Cockpit summary", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("persists equal cockpit panes and reflows after an empty pane closes", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-layout-",
    title: "Cockpit layout",
    initialPrompt: "Verify cockpit pane persistence",
  });

  try {
    await openAgentRoute(page, workspace);
    await page.keyboard.press("Control+Alt+C");
    await expect(page).toHaveURL(/\/cockpit$/);

    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const fullWidth = (await card.boundingBox())?.width ?? 0;
    const focusedBorderColor = await card.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );

    await page.keyboard.press("Control+\\");
    const emptyPane = page.getByTestId(/^cockpit-empty-pane-/);
    await expect(emptyPane).toBeVisible();
    const unfocusedBorderColor = await card.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    const emptyPaneBorderColor = await emptyPane.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    expect(unfocusedBorderColor).not.toBe(focusedBorderColor);
    expect(emptyPaneBorderColor).toBe(focusedBorderColor);
    const splitCardWidth = (await card.boundingBox())?.width ?? 0;
    const splitEmptyWidth = (await emptyPane.boundingBox())?.width ?? 0;
    expect(Math.abs(splitCardWidth - splitEmptyWidth)).toBeLessThanOrEqual(2);
    expect(splitCardWidth).toBeLessThan(fullWidth);

    await page.keyboard.press("Control+Shift+\\");
    await expect(emptyPane).toHaveCount(2);
    const upperPaneHeight = (await emptyPane.nth(0).boundingBox())?.height ?? 0;
    const lowerPaneHeight = (await emptyPane.nth(1).boundingBox())?.height ?? 0;
    expect(Math.abs(upperPaneHeight - lowerPaneHeight)).toBeLessThanOrEqual(2);

    await page.reload();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const restoredEmptyPanes = page.getByTestId(/^cockpit-empty-pane-/);
    await expect(restoredEmptyPanes).toHaveCount(2, { timeout: 30_000 });

    await restoredEmptyPanes.nth(1).getByRole("button", { name: "Close pane" }).click();
    await expect(restoredEmptyPanes).toHaveCount(1);
    await restoredEmptyPanes.first().getByRole("button", { name: "Close pane" }).click();
    await expect(restoredEmptyPanes).toHaveCount(0);
    await expect
      .poll(async () => (await card.boundingBox())?.width ?? 0)
      .toBeGreaterThan(splitCardWidth);
  } finally {
    await workspace.cleanup();
  }
});

test("shows a spinner while a cockpit workspace is running", async ({ page }) => {
  const workspace = await seedRunningMockAgentWorkspace({
    repoPrefix: "cockpit-running-",
    title: "Cockpit running",
    initialPrompt: "Keep this workspace running",
    featureValues: {
      mockStreamingAssistantResponse: Array.from(
        { length: 120 },
        (_, index) => `progress-${index}`,
      ).join(" "),
      mockStreamingAssistantIntervalMs: 1_000,
    },
  });

  try {
    await openAgentRoute(page, workspace);
    await page.getByTestId("cockpit-mode-toggle").click();
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    await expect(card.getByTestId("cockpit-running-spinner")).toBeVisible({ timeout: 30_000 });
  } finally {
    await workspace.cleanup();
  }
});

test("archives a workspace when its cockpit pane closes", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-archive-",
    title: "Cockpit archive",
    initialPrompt: "Archive this workspace from cockpit",
  });

  try {
    await openAgentRoute(page, workspace);
    await page.getByTestId("cockpit-mode-toggle").click();

    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const result = await workspace.client.fetchWorkspaces();
        return result.entries.some((entry) => entry.id === workspace.workspaceId);
      })
      .toBe(true);

    await card.getByRole("button", { name: "Archive workspace" }).click();

    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = await workspace.client.fetchWorkspaces();
        return result.entries.some((entry) => entry.id === workspace.workspaceId);
      })
      .toBe(false);
  } finally {
    await workspace.cleanup();
  }
});
