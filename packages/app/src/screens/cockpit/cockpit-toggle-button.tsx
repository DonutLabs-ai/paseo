import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, PanelTop } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { iconButtonChromeGlyphSize } from "@/components/ui/icon-button-chrome";

export function CockpitToggleButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const label = active ? t("cockpit.actions.returnToWorkspace") : t("cockpit.actions.open");
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);

  return (
    <HeaderToggleButton
      onPress={onPress}
      tooltipLabel={label}
      tooltipKeys={[]}
      tooltipSide="bottom"
      style={active ? styles.active : undefined}
      testID="cockpit-mode-toggle"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      {active ? (
        <ThemedReturnIcon size={iconButtonChromeGlyphSize("large")} strokeWidth={1.5} />
      ) : (
        <ThemedCockpitIcon size={iconButtonChromeGlyphSize("large")} strokeWidth={1.5} />
      )}
    </HeaderToggleButton>
  );
}

const ThemedCockpitIcon = withUnistyles(LayoutDashboard, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedReturnIcon = withUnistyles(PanelTop, (theme) => ({
  color: theme.colors.foreground,
}));

const styles = StyleSheet.create((theme) => ({
  active: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
