import { memo } from "react";
import { View } from "react-native";
import {
  StatusRingFrame,
  type StatusRingProps,
  rotatorStyles,
  styles,
} from "@/components/status-ring/frame";
import { useStatusRingAnimationRef } from "@/components/status-ring/clock.web";

/**
 * Web running indicator. A sidebar full of agents can hold dozens of these at once, so the browser
 * drives the rotation from one absolute document-timeline epoch rather than from mount time — see
 * `clock.web.ts`.
 */
export const StatusRing = memo(function StatusRing({
  backdrop,
  size = "default",
  testID,
}: StatusRingProps) {
  const rotatorRef = useStatusRingAnimationRef();
  const large = size === "large";

  return (
    <StatusRingFrame backdrop={backdrop} size={size} testID={testID}>
      <View
        ref={rotatorRef}
        style={[rotatorStyles.rotator, large ? rotatorStyles.rotatorLarge : null]}
      >
        <View style={[styles.arc, large ? styles.arcLarge : null]} />
      </View>
    </StatusRingFrame>
  );
});
