import React from "react";

import { GradientMesh } from "@/components/GradientMesh";
import { Box } from "@/components/ui";

interface AuthBackgroundProps {
  children: React.ReactNode;
}

export const AuthBackground = ({
  children,
}: AuthBackgroundProps): React.ReactElement => {
  return (
    <Box style={{ flex: 1 }}>
      <Box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
        pointerEvents="none"
      >
        <GradientMesh />
      </Box>
      {children}
    </Box>
  );
};
