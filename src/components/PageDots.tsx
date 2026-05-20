import React from 'react';
import { View, StyleSheet } from 'react-native';

interface PageDotsProps {
  total: number;
  active: number;
}

export const PageDots = ({
  total,
  active,
}: PageDotsProps): React.ReactElement => {
  return (
    <View style={styles.container}>
      {Array.from({ length: total }).map((_, i) => {
        const isActive = i === active;

        return (
          <View
            key={i}
            style={[
              styles.dot,
              isActive ? styles.activeDot : styles.inactiveDot,
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  dot: { height: 6, borderRadius: 3 },
  activeDot: { width: 32, backgroundColor: '#3B82F6' }, // default primary, though should ideally useTheme if needed
  inactiveDot: { width: 6, backgroundColor: '#D4D4D8' },
});
