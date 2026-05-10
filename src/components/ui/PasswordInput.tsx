/**
 * PasswordInput — Input with secure text + eye toggle.
 */
import { Eye, EyeOff } from 'lucide-react-native';
import React, { forwardRef, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';

import { Input, InputProps } from '@/components/ui/Input';
import { useTheme } from '@/hooks';

export const PasswordInput = forwardRef<TextInput, Omit<InputProps, 'secureTextEntry'>>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    const { color } = useTheme();

    return (
      <View style={{ position: 'relative' }}>
        <Input
          ref={ref}
          secureTextEntry={!visible}
          style={{ paddingRight: 52 }}
          {...props}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          style={{
            position: 'absolute',
            right: 16,
            top: 0,
            height: 56,
            justifyContent: 'center',
          }}
          hitSlop={12}
        >
          {visible ? (
            <EyeOff size={20} color={color.muted} />
          ) : (
            <Eye size={20} color={color.muted} />
          )}
        </Pressable>
      </View>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
