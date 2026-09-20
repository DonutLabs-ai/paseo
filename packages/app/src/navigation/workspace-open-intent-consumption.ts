export interface WorkspaceOpenIntentConsumption {
  shouldConsume: boolean;
  nextConsumedOpenValue: string | null;
}

/**
 * Workspace open intents are one-shot navigation commands. A stale route param must not be
 * consumed again when the dynamic workspace segment changes underneath the mounted route.
 */
export function resolveWorkspaceOpenIntentConsumption(input: {
  openValue: string;
  consumedOpenValue: string | null;
}): WorkspaceOpenIntentConsumption {
  const openValue = input.openValue.trim();
  if (!openValue) {
    return { shouldConsume: false, nextConsumedOpenValue: null };
  }
  if (openValue === input.consumedOpenValue) {
    return { shouldConsume: false, nextConsumedOpenValue: input.consumedOpenValue };
  }
  return { shouldConsume: true, nextConsumedOpenValue: openValue };
}
