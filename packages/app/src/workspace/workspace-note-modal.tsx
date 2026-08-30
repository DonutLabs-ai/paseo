import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { normalizeWorkspaceNote, WORKSPACE_NOTE_MAX_LENGTH } from "./workspace-note";

interface WorkspaceNoteModalProps {
  visible: boolean;
  note: string | null;
  fallbackTitle: string;
  onClose: () => void;
  onSubmit: (note: string | null) => Promise<void> | void;
  testID?: string;
}

export function WorkspaceNoteModal({
  visible,
  note,
  fallbackTitle,
  onClose,
  onSubmit,
  testID,
}: WorkspaceNoteModalProps) {
  const { t } = useTranslation();
  const handleSubmit = useCallback(
    (value: string) => onSubmit(normalizeWorkspaceNote(value)),
    [onSubmit],
  );

  return (
    <AdaptiveRenameModal
      visible={visible}
      title={t("sidebar.workspace.rename.title")}
      initialValue={note ?? ""}
      placeholder={fallbackTitle}
      submitLabel={t("sidebar.workspace.rename.submit")}
      onClose={onClose}
      onSubmit={handleSubmit}
      allowEmpty
      maxLength={WORKSPACE_NOTE_MAX_LENGTH}
      testID={testID}
    />
  );
}
