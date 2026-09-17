import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { T, useGT, useMessages, Var } from 'gt-react-native';
import { memo, useCallback, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { InviteQrCode } from '@/components/invites/InviteQrCode';
import { Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import {
  buildInviteShareMessage,
  inviteModeLabel,
  inviteRoleLabel,
  type InviteMode,
  type InviteRole,
} from '@/features/invites/preview-state';
import { useTheme } from '@/hooks/use-theme';

export interface InviteComposerSubmitArgs {
  mode: InviteMode;
  invitedEmail?: string;
  role: InviteRole;
}

export interface InviteComposerResult {
  inviteLink: string;
  /** Display form of the short code (`K7MF3-QX9WD`). */
  code: string;
}

interface LastInvite {
  inviteLink: string;
  code: string;
  mode: InviteMode;
  invitedEmail: string | null;
  role: InviteRole;
}

interface InviteComposerProps {
  circleName: string;
  disabled?: boolean;
  onCreateInvite: (args: InviteComposerSubmitArgs) => Promise<InviteComposerResult>;
  onFeedback: (message: string | null) => void;
}

export const InviteComposer = memo(function InviteComposer({
  circleName,
  disabled = false,
  onCreateInvite,
  onFeedback,
}: InviteComposerProps) {
  const theme = useTheme();
  const gt = useGT();
  const m = useMessages();
  const [mode, setMode] = useState<InviteMode>('email');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastInvite, setLastInvite] = useState<LastInvite | null>(null);
  const [showQr, setShowQr] = useState(false);

  const shareInvite = useCallback(
    async (invite: LastInvite) => {
      await Share.share({
        message: m(
          buildInviteShareMessage({
            circleName,
            inviteLink: invite.inviteLink,
            code: invite.code,
            mode: invite.mode,
          }),
        ),
      });
    },
    [circleName, m],
  );

  const copyInvite = useCallback(
    async (invite: LastInvite, what: 'link' | 'code') => {
      try {
        await Clipboard.setStringAsync(what === 'link' ? invite.inviteLink : invite.code);
        onFeedback(what === 'link' ? gt('Link kopiert.') : gt('Code kopiert.'));
      } catch {
        onFeedback(gt('Kopieren hat nicht geklappt.'));
      }
    },
    [gt, onFeedback],
  );

  const handleCreateInvite = useCallback(async () => {
    const normalizedEmail = invitedEmail.trim().toLowerCase();

    if (mode === 'email' && !normalizedEmail) {
      onFeedback(gt('Gib eine E-Mail-Adresse ein oder wähle einen offenen Einmal-Link.'));
      return;
    }

    setIsSubmitting(true);
    onFeedback(null);

    try {
      const created = await onCreateInvite({
        mode,
        ...(mode === 'email' ? { invitedEmail: normalizedEmail } : {}),
        role,
      });
      const nextInvite = {
        inviteLink: created.inviteLink,
        code: created.code,
        mode,
        invitedEmail: mode === 'email' ? normalizedEmail : null,
        role,
      };

      setLastInvite(nextInvite);
      setShowQr(false);
      setInvitedEmail('');
      onFeedback(gt('Einladung erstellt.'));
      await shareInvite(nextInvite);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Einladung konnte nicht erstellt werden.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [gt, invitedEmail, mode, onCreateInvite, onFeedback, role, shareInvite]);

  const handleShareLastInvite = useCallback(async () => {
    if (!lastInvite) {
      return;
    }

    try {
      await shareInvite(lastInvite);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Invite-Link konnte nicht geteilt werden.'),
      );
    }
  }, [gt, lastInvite, onFeedback, shareInvite]);

  const canSubmit = !disabled && !isSubmitting && (mode === 'open' || invitedEmail.trim().length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <T>
          <Text style={[styles.kicker, { color: theme.textTertiary }]}>Einladen</Text>
          <Text style={[styles.title, { color: theme.text }]}>Link erstellen</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Persönliche Links bleiben an eine E-Mail gebunden. Offene Links sind einmalig nutzbar.
          </Text>
        </T>
      </View>

      <View style={styles.segmented}>
        <InviteSegment
          active={mode === 'email'}
          icon="mail-outline"
          label={gt('E-Mail')}
          onPress={() => setMode('email')}
        />
        <InviteSegment
          active={mode === 'open'}
          icon="link-outline"
          label={gt('Offen')}
          onPress={() => setMode('open')}
        />
      </View>

      {mode === 'email' ? (
        <TextInput
          value={invitedEmail}
          onChangeText={setInvitedEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="name@example.com"
          placeholderTextColor={theme.textTertiary}
          editable={!disabled && !isSubmitting}
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
      ) : null}

      <View style={styles.roleSwitch}>
        <RoleButton
          label={gt('Mitglied')}
          active={role === 'member'}
          onPress={() => setRole('member')}
        />
        <RoleButton label={gt('Admin')} active={role === 'admin'} onPress={() => setRole('admin')} />
      </View>

      <Button
        label={isSubmitting ? gt('Erstellt...') : gt('Invite-Link erstellen')}
        icon="person-add-outline"
        loading={isSubmitting}
        disabled={!canSubmit}
        onPress={() => {
          void handleCreateInvite();
        }}
      />

      {lastInvite ? (
        <View style={[styles.invitePreview, { backgroundColor: theme.background }]}>
          <View style={styles.previewHeader}>
            <T>
              <Text style={[styles.kicker, { color: theme.textTertiary }]}>letzter link</Text>
              <Text style={[styles.previewMeta, { color: theme.textSecondary }]}>
                <Var>{m(inviteModeLabel(lastInvite.mode))}</Var> ·{' '}
                <Var>{m(inviteRoleLabel(lastInvite.role))}</Var>
              </Text>
            </T>
          </View>
          {lastInvite.invitedEmail ? (
            <Text style={[styles.previewMeta, { color: theme.textSecondary }]} numberOfLines={1}>
              {lastInvite.invitedEmail}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt('Code kopieren')}
            onPress={() => {
              void copyInvite(lastInvite, 'code');
            }}
            style={({ pressed }) => [
              styles.codeBox,
              { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <T>
              <Text style={[styles.kicker, { color: theme.textTertiary }]}>Code zum Eintippen</Text>
            </T>
            <Text style={[styles.codeText, { color: theme.text }]} selectable>
              {lastInvite.code}
            </Text>
            <Ionicons name="copy-outline" size={16} color={theme.textSecondary} />
          </Pressable>
          <Text selectable style={[styles.linkText, { color: theme.primary }]}>
            {lastInvite.inviteLink}
          </Text>
          {showQr ? <InviteQrCode value={lastInvite.inviteLink} /> : null}
          <View style={styles.actionRow}>
            <View style={styles.actionCol}>
              <Button
                label={gt('Teilen')}
                icon="share-social-outline"
                variant="outline"
                onPress={() => {
                  void handleShareLastInvite();
                }}
              />
            </View>
            <View style={styles.actionCol}>
              <Button
                label={showQr ? gt('QR ausblenden') : gt('QR zeigen')}
                icon="qr-code-outline"
                variant="outline"
                onPress={() => setShowQr((current) => !current)}
              />
            </View>
          </View>
          <Button
            label={gt('Link kopieren')}
            icon="link-outline"
            variant="ghost"
            onPress={() => {
              void copyInvite(lastInvite, 'link');
            }}
          />
        </View>
      ) : null}
    </View>
  );
});

const InviteSegment = memo(function InviteSegment({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: active ? theme.primaryMuted : theme.background,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? theme.primary : theme.textSecondary} />
      <Text style={[styles.segmentText, { color: active ? theme.primary : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const RoleButton = memo(function RoleButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleButton,
        {
          backgroundColor: active ? theme.accentMuted : theme.background,
          borderColor: active ? theme.accent : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text style={[styles.roleButtonText, { color: active ? theme.accent : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  copy: {
    gap: 5,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segment: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  segmentText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  roleSwitch: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  roleButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  roleButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  invitePreview: {
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  previewHeader: {
    gap: 3,
  },
  previewMeta: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  linkText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  codeText: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionCol: {
    flex: 1,
  },
});
