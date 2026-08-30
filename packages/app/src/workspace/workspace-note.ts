export const WORKSPACE_NOTE_MAX_LENGTH = 200;

export function normalizeWorkspaceNote(value: string): string | null {
  const singleLine = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return singleLine.length === 0 ? null : singleLine;
}
