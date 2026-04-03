import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface EkweBannerProps {
  message: string;
  visible: boolean;
}

export const EkweBanner: React.FC<EkweBannerProps> = ({ message, visible }) => {
  if (!visible) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: lightTokens.space[2],
    paddingHorizontal: lightTokens.space[4],
    backgroundColor: lightTokens.color.status.info,
    borderRadius: lightTokens.radius.sm,
  },
  text: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.label,
    color: lightTokens.color.text.inverse,
  },
});
