import React, { forwardRef } from 'react';
import {
  Modal as RNModal,
  type ModalProps as RNModalProps,
  View,
  type ViewStyle,
} from 'react-native';

import { Pressable } from './Pressable';

import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTokens } from '@/hooks/ui/useTokens';

export type ModalProps = RNModalProps & {
  onBackdropPress?: () => void;
  containerStyle?: ViewStyle;
};

export const Modal = React.memo(
  forwardRef<View, ModalProps>(
    (
      {
        transparent = true,
        animationType = 'slide',
        onBackdropPress,
        containerStyle,
        children,
        ...props
      },
      ref,
    ) => {
      const { color } = useTokens();

      return (
        <RNModal
          ref={ref as unknown as React.Ref<RNModal>}
          transparent={transparent}
          animationType={animationType}
          {...props}
        >
          <View
            style={[
              {
                flex: 1,
                backgroundColor: color.overlay,
                justifyContent: 'flex-end',
              },
              containerStyle,
            ]}
          >
            {onBackdropPress && (
              <Pressable
                onPress={onBackdropPress}
                style={{ flex: 1 }}
                feedback="none"
              />
            )}
            <View
              style={{
                backgroundColor: color.card,
                borderTopLeftRadius: borderRadius.xl,
                borderTopRightRadius: borderRadius.xl,
                paddingBottom: spacing.xl,
              }}
            >
              {children}
            </View>
          </View>
        </RNModal>
      );
    },
  ),
);

Modal.displayName = 'Modal';
