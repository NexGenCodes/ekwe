import React, { type JSX } from "react";

import { Text } from "@/components/ui";
import { getLanguageFlag } from "@/constants/languages";

export interface LanguageFlagProps {
  code: string;
  size?: "sm" | "md";
}

function LanguageFlagComponent({
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
      {getLanguageFlag(code)}
    </Text>
  );
}

export const LanguageFlag = React.memo(LanguageFlagComponent);
LanguageFlag.displayName = "LanguageFlag";
