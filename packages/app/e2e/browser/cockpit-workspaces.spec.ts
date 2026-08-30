import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  seedRunningMockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { submitNewWorkspacePrompt } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";
import { STATUS_RING_FRAME_SIZE } from "../../src/components/status-ring/geometry";

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

test("opens a workspace script in the global utility tray across workspace and cockpit routes", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "utility-tray-",
    title: "Utility tray",
    initialPrompt: "Verify the global utility tray",
    repo: {
      paseoConfig: {
        scripts: {
          "process-compose": {
            type: "script",
            command:
              "node -e \"console.log('process-compose ready'); setInterval(() => {}, 1000)\"",
          },
        },
      },
    },
  });

  try {
    await openAgentRoute(page, workspace);
    const trigger = page.getByTestId("utility-tray-trigger");
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId("utility-tray-overlay")).toBeVisible();
    const scriptRow = page.getByTestId(
      `utility-tray-script-${getServerId()}:${workspace.workspaceId}:process-compose`,
    );
    await expect(scriptRow).toBeVisible({ timeout: 15_000 });
    await scriptRow.click();
    await page.getByTestId("utility-tray-start").click();
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("utility-tray-close").click();
    await expect(page.getByTestId("utility-tray-overlay")).toHaveCount(0);

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId("utility-tray-overlay")).toBeVisible();
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
  } finally {
    await workspace.cleanup();
  }
});

test("dismisses the utility tray after an outside press", async ({ page }) => {
  await gotoAppShell(page);

  const trigger = page.getByTestId("utility-tray-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(page.getByTestId("utility-tray-overlay")).toBeVisible();
  await page.getByTestId("sidebar-settings").click();
  await expect(page.getByTestId("utility-tray-overlay")).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings\/general$/);

  await trigger.click();
  await expect(page.getByTestId("utility-tray-overlay")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("utility-tray-overlay")).toHaveCount(0);
});

test("focuses the cockpit card when its quick reply input receives focus", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-quick-reply-focus-",
    title: "Cockpit quick reply focus",
    initialPrompt: "Verify quick reply focus",
  });

  try {
    await openAgentRoute(page, workspace);
    await page.getByTestId("cockpit-mode-toggle").click();

    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    const input = page.getByTestId(`cockpit-quick-reply-input-${workspace.agentId}`);
    await expect(input).toBeVisible({ timeout: 30_000 });
    const focusedFrame = await card.evaluate((element) => getComputedStyle(element).boxShadow);

    await page.keyboard.press("Control+\\");
    const emptyPane = page.getByTestId(/^cockpit-empty-pane-/);
    await expect(emptyPane).toBeVisible();
    await expect
      .poll(async () => card.evaluate((element) => getComputedStyle(element).boxShadow))
      .not.toBe(focusedFrame);

    await input.click();
    await expect(input).toBeFocused();
    await expect
      .poll(async () => card.evaluate((element) => getComputedStyle(element).boxShadow))
      .toBe(focusedFrame);
  } finally {
    await workspace.cleanup();
  }
});

test("reopens cockpit after creating a workspace from an empty pane", async ({ page }) => {
  const workspace = await seedWorkspace({
    repoPrefix: "cockpit-new-workspace-",
    title: "Cockpit source workspace",
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  try {
    const serverId = getServerId();
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await switchWorkspaceViaSidebar({
      page,
      serverId,
      workspaceId: workspace.workspaceId,
    });

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);
    await page.keyboard.press("Control+\\");
    const emptyPane = page.getByTestId(/^cockpit-empty-pane-/);
    await expect(emptyPane).toBeVisible();
    await emptyPane.getByRole("button", { name: "New workspace", exact: true }).click();
    await expect(page).toHaveURL(/\/new(?:\?.*)?$/);

    await submitNewWorkspacePrompt(page, "Create a workspace from cockpit");
    await expect(page).toHaveURL(new RegExp(`/h/${serverId}/workspace/`), {
      timeout: 60_000,
    });
    await expect
      .poll(
        async () => {
          const result = await workspace.client.fetchWorkspaces({
            filter: { projectId: workspace.projectId },
          });
          return result.entries.some((entry) => entry.id !== workspace.workspaceId);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const result = await workspace.client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    const createdWorkspace =
      result.entries.find((entry) => entry.id !== workspace.workspaceId) ?? null;
    if (!createdWorkspace) {
      throw new Error("New workspace was not returned by the daemon");
    }
    await waitForWorkspaceInSidebar(page, {
      serverId,
      workspaceId: createdWorkspace.id,
    });

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);
    await expect(
      page.getByTestId(`cockpit-workspace-card-${serverId}:${createdWorkspace.id}`),
    ).toBeVisible({ timeout: 30_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await workspace.cleanup();
  }
});

test("opens cockpit when persisted pane focus differs from the active workspace", async ({
  page,
}) => {
  const firstWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-focus-first-",
    title: "Cockpit first focus",
    initialPrompt: "Keep the first cockpit pane focused",
  });
  const secondWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "cockpit-focus-second-",
    title: "Cockpit second focus",
    initialPrompt: "Open cockpit from the second workspace",
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  try {
    const serverId = getServerId();
    await openAgentRoute(page, firstWorkspace);
    await waitForWorkspaceInSidebar(page, {
      serverId,
      workspaceId: secondWorkspace.workspaceId,
    });

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);
    await expect(
      page.getByTestId(`cockpit-workspace-card-${serverId}:${firstWorkspace.workspaceId}`),
    ).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(
      new RegExp(`/h/${serverId}/workspace/${firstWorkspace.workspaceId}`),
    );
    await switchWorkspaceViaSidebar({
      page,
      serverId,
      workspaceId: secondWorkspace.workspaceId,
    });

    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);
    await expect(
      page.getByTestId(`cockpit-workspace-card-${serverId}:${secondWorkspace.workspaceId}`),
    ).toBeVisible({ timeout: 30_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await firstWorkspace.cleanup();
    await secondWorkspace.cleanup();
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
    await page.keyboard.press("F9");
    await expect(page).toHaveURL(/\/cockpit$/);

    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
    const card = page.getByTestId(`cockpit-workspace-card-${workspaceKey}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const fullWidth = (await card.boundingBox())?.width ?? 0;
    const focusedBorderColor = await card.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    const splitDownBounds = await card
      .getByRole("button", { name: "Split pane down" })
      .boundingBox();
    const archiveBounds = await card
      .getByRole("button", { name: "Archive workspace" })
      .boundingBox();
    if (!splitDownBounds || !archiveBounds) {
      throw new Error("Expected cockpit pane action buttons to have layout bounds");
    }
    expect(archiveBounds.x - (splitDownBounds.x + splitDownBounds.width)).toBeGreaterThanOrEqual(8);

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
    const spinner = card.getByTestId("cockpit-running-spinner");
    await expect(spinner).toBeVisible({ timeout: 30_000 });
    const bounds = await spinner.boundingBox();
    expect(bounds?.width).toBe(STATUS_RING_FRAME_SIZE);
    expect(bounds?.height).toBe(STATUS_RING_FRAME_SIZE);
    await expect(spinner.getByRole("progressbar")).toHaveCount(0);
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

    const archiveButton = card.getByRole("button", { name: "Archive workspace" });
    let dismissedConfirmation = false;
    page.once("dialog", (dialog) => {
      dismissedConfirmation = true;
      void dialog.dismiss();
    });
    await archiveButton.click();

    expect(dismissedConfirmation).toBe(true);
    await expect(card).toBeVisible();
    await expect
      .poll(async () => {
        const result = await workspace.client.fetchWorkspaces();
        return result.entries.some((entry) => entry.id === workspace.workspaceId);
      })
      .toBe(true);

    let acceptedConfirmation = false;
    page.once("dialog", (dialog) => {
      acceptedConfirmation = true;
      void dialog.accept();
    });
    await archiveButton.click();

    expect(acceptedConfirmation).toBe(true);
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
