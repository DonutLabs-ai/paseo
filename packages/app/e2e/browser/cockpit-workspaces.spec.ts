import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
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
