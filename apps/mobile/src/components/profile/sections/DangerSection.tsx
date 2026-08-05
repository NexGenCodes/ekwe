import LogOut from "lucide-react-native/icons/log-out";
import Trash2 from "lucide-react-native/icons/trash-2";
import React from "react";

import { ProfileRow } from "../ProfileRow";
import { AnimatedSection } from "./AnimatedSection";

import { useTheme } from "@/hooks";
import { triggerHaptic } from "@/utils/haptics";

interface DangerSectionProps {
  onLogout: () => void;
  onDeleteAccount: () => void;
}

export function DangerSection({
  onLogout,
  onDeleteAccount,
}: DangerSectionProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <AnimatedSection delay={300} title="Account" titleColor={color.error}>
      <ProfileRow
        icon={LogOut}
        sfIcon="rectangle.portrait.and.arrow.right"
        iconColor={color.error}
        title="Log Out"
        subtitle="Sign out of your session"
        hasDivider
        onPress={async () => {
          await triggerHaptic();
          onLogout();
        }}
        trailing={null}
      />
      <ProfileRow
        icon={Trash2}
        sfIcon="trash.fill"
        iconColor={color.error}
        title="Delete Account"
        subtitle="Permanently delete your data"
        onPress={async () => {
          await triggerHaptic();
          onDeleteAccount();
        }}
        trailing={null}
      />
    </AnimatedSection>
  );
}
