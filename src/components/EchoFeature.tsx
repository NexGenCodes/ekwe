import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  useColorScheme,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { useShareIntent } from 'expo-share-intent';
import EkweNative from '../../modules/ekwe-native';

// --- Official Ekwe single source of truth ---
import { getColor } from '@/constants/colors';

interface SharedFile {
  value: string;
  type: string;
  mimeType: string;
}

interface IOSProps {
  value?: SharedFile[];
  type?: string;
}

interface AndroidProps {
  audioUri?: string;
  mimeType?: string;
  fileName?: string;
  sourceApp?: string;
}

type Props = IOSProps & AndroidProps;

/**
 * Echo Feature Entry Point
 */
export default function EchoFeature(props: Props) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const { resetShareIntent } = useShareIntent({ disabled: Platform.OS === 'android' });
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Strict Brand Adherence: Derived entirely from Ekwe Design Principles
  const bgHex = getColor('card', isDark);
  const handleHex = getColor('border', isDark);
  const textPrimary = getColor('foreground', isDark);
  const textSecondary = getColor('muted', isDark);
  const brandPrimary = getColor('primary', isDark);

  const isIOS = Platform.OS === 'ios';
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;
  
  const audioUri = hasIOSFiles ? props.value![0].value : props.audioUri;
  const mimeType = hasIOSFiles ? props.value![0].mimeType : props.mimeType;
  const fileName = hasIOSFiles ? props.value![0].value.split('/').pop() : props.fileName;
  const sourceApp = isIOS ? 'iOS Device' : props.sourceApp;

  useEffect(() => {
    if (Platform.OS === 'android') {
      EkweNative.dismissNativeLoader();
    }
  }, []);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.close();
  }, []);

  const onSheetChange = useCallback((index: number) => {
    if (index === -1) {
      if (Platform.OS === 'android') {
        EkweNative.dismissEcho();
      } else {
        resetShareIntent(true);
      }
    }
  }, [resetShareIntent]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} pressBehavior="close" />
    ),
    []
  );

  return (
    <View style={styles.container}>
      <BottomSheet
        ref={bottomSheetRef}
        enableDynamicSizing={true}
        enablePanDownToClose={true}
        onChange={onSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={[{ backgroundColor: bgHex }]}
        handleIndicatorStyle={[styles.handle, { backgroundColor: handleHex }]}
      >
        <BottomSheetView style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.label, { color: brandPrimary }]}>EKWE ECHO</Text>
            <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: handleHex }]}>
              <Text style={[styles.closeBtnText, { color: textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Hello World Body */}
          <Text style={[styles.helloText, { color: textPrimary }]}>Hello World</Text>
          <Text style={[styles.metaText, { color: textSecondary }]} numberOfLines={1} ellipsizeMode="middle">
            {audioUri ? `File: ${fileName || 'voice_note.opus'}` : 'No audio received'}
          </Text>
          {mimeType && <Text style={[styles.metaText, { color: textSecondary }]}>MIME: {mimeType}</Text>}
          {sourceApp && <Text style={[styles.metaText, { color: textSecondary }]}>From: {sourceApp}</Text>}

          {/* Action Button */}
          <TouchableOpacity onPress={handleClose} style={[styles.dismissBtn, { backgroundColor: brandPrimary }]}>
            <Text style={[styles.dismissBtnText, { color: getColor('onPrimary', isDark) }]}>Dismiss</Text>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// Complete removal of hardcoded colors from the static stylesheet
const styles = StyleSheet.create({
  container: { flex: 1 },
  handle: { width: 40, height: 4 },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center'
  },
  closeBtnText: { fontSize: 12 },
  
  helloText: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  metaText: {
    fontSize: 13,
    marginBottom: 4,
    textAlign: 'center',
  },
  dismissBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 24,
  },
  dismissBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
