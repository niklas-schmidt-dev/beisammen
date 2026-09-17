import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { T, useGT } from 'gt-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedPressable, Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { parseInviteToken } from '@/features/invites/parse-invite-token';

/**
 * Fullscreen QR scanner for invites. Only QR symbols are decoded, and only
 * ones that parse as an invite link or code are reported; everything else is
 * ignored so pointing the camera at an unrelated code does nothing.
 */
export const InviteQrScanner = memo(function InviteQrScanner({
  onClose,
  onScanned,
  visible,
}: {
  onClose: () => void;
  onScanned: (token: string) => void;
  visible: boolean;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [hasUnrecognizedCode, setHasUnrecognizedCode] = useState(false);
  const hasReported = useRef(false);

  useEffect(() => {
    if (visible) {
      hasReported.current = false;
      setHasUnrecognizedCode(false);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission, visible]);

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      if (hasReported.current) {
        return;
      }

      const token = parseInviteToken(data);

      if (!token) {
        setHasUnrecognizedCode(true);
        return;
      }

      hasReported.current = true;
      onScanned(token);
    },
    [onScanned],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleScanned}
          />
        ) : (
          <View style={[styles.permission, { paddingTop: insets.top + Spacing['3xl'] }]}>
            <Ionicons name="camera-outline" size={40} color="rgba(255,255,255,0.7)" />
            <T>
              <Text style={styles.permissionTitle}>Kamera-Zugriff nötig</Text>
              <Text style={styles.permissionBody}>
                Zum Scannen eines Einladungs-QR-Codes braucht beisammen Zugriff auf die Kamera.
              </Text>
            </T>
            {permission?.canAskAgain !== false ? (
              <Button
                label={gt('Zugriff erlauben')}
                icon="camera-outline"
                onPress={() => {
                  void requestPermission();
                }}
              />
            ) : null}
          </View>
        )}

        <View style={styles.frameLayer} pointerEvents="none">
          <View style={styles.frame} />
        </View>

        <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={gt('Schließen')}
            hitSlop={8}
            onPress={onClose}
            pressedScale={0.94}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </AnimatedPressable>
        </View>

        <View style={[styles.caption, { bottom: insets.bottom + Spacing.xl }]} pointerEvents="none">
          <Text style={styles.captionText}>
            {hasUnrecognizedCode
              ? gt('Das ist kein beisammen-Einladungscode.')
              : gt('QR-Code der Einladung in den Rahmen halten')}
          </Text>
        </View>
      </View>
    </Modal>
  );
});

const FRAME_SIZE = 240;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050505',
  },
  permission: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionBody: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FontSize.base,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  frameLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderRadius: Radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  topBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
  caption: {
    position: 'absolute',
    left: Spacing.xl,
    right: Spacing.xl,
    alignItems: 'center',
  },
  captionText: {
    color: '#FFFFFF',
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
});
