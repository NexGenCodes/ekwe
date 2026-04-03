import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface LanguagePickerSheetProps {
  visible: boolean;
}

export const LanguagePickerSheet: React.FC<LanguagePickerSheetProps> = ({
  visible,
}) => {
  if (!visible) return null;
  return (
    <View style={styles.container}>
      <Text>Language picker — Phase 2</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
});
