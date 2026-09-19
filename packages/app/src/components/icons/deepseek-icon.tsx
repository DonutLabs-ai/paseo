import { FishSymbol } from "lucide-react-native";

interface DeepSeekIconProps {
  size?: number;
  color?: string;
}

export function DeepSeekIcon({ size = 16, color = "currentColor" }: DeepSeekIconProps) {
  return <FishSymbol size={size} color={color} strokeWidth={1.8} />;
}
