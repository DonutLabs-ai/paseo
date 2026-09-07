import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";

export function SidebarSnoozedSection({ count, children }: { count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  if (count === 0) {
    return null;
  }

  return (
    <View testID="sidebar-snoozed-section">
      <SidebarGroupToggleRow
        expanded={expanded}
        label={`${t("cockpit.status.snoozed")} (${count})`}
        onPress={toggleExpanded}
        testID="sidebar-snoozed-toggle"
      />
      {expanded ? <View testID="sidebar-snoozed-list">{children}</View> : null}
    </View>
  );
}
