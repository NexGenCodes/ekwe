import type { JSX } from "react";

import { Text } from "@/components/ui";
import { FLAG_MAP } from "@/constants/languages";

export interface LanguageFlagProps {
  code: string;
  size?: "sm" | "md";
}

export function LanguageFlag({
  code,
  size = "md",
}: LanguageFlagProps): JSX.Element {
  if (!code || code === "auto") {
    return (
      <Text variant={size === "sm" ? "body" : "heading2"}>
        {code === "auto" ? "🌐" : "🔍"}
      </Text>
    );
  }
  return (
    <Text variant={size === "sm" ? "body" : "heading2"}>
      {FLAG_MAP[code] || "🏳️"}
    </Text>
  );
}
