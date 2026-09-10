import type { ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { reportAppError } from './errors';

// This boundary can replace GTProvider itself. Keep its two small translations
// local so recovery works even when translations or app providers cannot mount.
const copy = {
  de: {
    title: 'Das hat gerade nicht geklappt.',
    body: 'Diese Ansicht konnte nicht geladen werden. Bitte versuche es noch einmal.',
    retry: 'Erneut versuchen',
  },
  en: {
    title: 'Something went wrong.',
    body: 'This screen could not be loaded. Please try again.',
    retry: 'Try again',
  },
};

export function AppErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const text = copy[Intl.DateTimeFormat().resolvedOptions().locale.startsWith('de') ? 'de' : 'en'];

  useEffect(() => {
    reportAppError('app.render', error);
    // A failure during startup must not leave the recovery screen under splash.
    void SplashScreen.hideAsync().catch(() => {});
  }, [error]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{text.title}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{text.body}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void retry(); }}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryText }]}>{text.retry}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32, paddingVertical: 64 },
  content: { width: '100%', maxWidth: 440, gap: 20 },
  title: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 38 },
  body: { fontSize: 17, lineHeight: 26 },
  button: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16 },
  buttonText: { fontSize: 17, fontWeight: '600' },
});
