import React from 'react';
import { View, StyleSheet } from 'react-native';

export const BubbleOverlay: React.FC = () => {
  return <View style={styles.container} />;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
  },
});
