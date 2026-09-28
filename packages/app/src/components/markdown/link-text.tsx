import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Pressable, Text, type StyleProp, type TextStyle } from "react-native";
import { useStableEvent } from "@/hooks/use-stable-event";
import { markdownLinkTextStyle } from "./link-children";

interface MarkdownLinkTextProps {
  href?: string;
  style: StyleProp<TextStyle>;
  dataSet?: Record<string, string>;
  onPress(): void;
  onHoverIn?(): void;
  children?: ReactNode;
}

export function MarkdownLinkText({
  href,
  style,
  dataSet,
  onPress,
  onHoverIn,
  children,
}: MarkdownLinkTextProps) {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useStableEvent(() => {
    setHovered(true);
    onHoverIn?.();
  });
  const handleHoverOut = useStableEvent(() => setHovered(false));
  const textStyle = useMemo(() => markdownLinkTextStyle(style, hovered), [hovered, style]);

  const content = (
    <Pressable
      accessibilityRole={href ? undefined : "link"}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
    >
      <Text dataSet={dataSet} style={textStyle}>
        {children}
      </Text>
    </Pressable>
  );

  if (!href) return content;
  return (
    <a
      href={href}
      onClickCapture={preventAnchorNavigation}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      {content}
    </a>
  );
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}
