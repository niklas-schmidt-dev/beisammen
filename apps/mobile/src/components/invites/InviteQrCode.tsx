import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

/**
 * QR code for an invite. Encodes the https invite link rather than the bare
 * code, so the system camera app opens it as a Universal Link / App Link and
 * the in-app scanner parses it through the same path as a pasted link.
 */
export const InviteQrCode = memo(function InviteQrCode({
  size = 176,
  value,
}: {
  size?: number;
  value: string;
}) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR-Code"
      style={[styles.frame, { width: size + 24, height: size + 24 }]}
    >
      <QRCode value={value} size={size} color="#111111" backgroundColor="#FFFFFF" ecl="M" />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
});
