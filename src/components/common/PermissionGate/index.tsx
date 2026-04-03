import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface PermissionGateProps {
  granted: boolean;
  permissionName: string;
  children: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  granted,
  permissionName,
  children,
}) => {
  if (granted) return <>{children}</>;
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{permissionName} permission is required</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: lightTokens.space[6],
  },
  text: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.secondary,
    textAlign: 'center',
  },
});
