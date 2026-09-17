import { msg } from 'gt-react-native';

export type InviteMode = 'email' | 'open';
export type InviteRole = 'admin' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InvitePreviewLike {
  mode: InviteMode;
  invitedEmail: string | null;
  status: InviteStatus;
  canAccept: boolean;
  emailMatchesViewer: boolean;
  isAlreadyMember: boolean;
}

export type InvitePreviewState =
  | { kind: 'loading'; title: string }
  | { kind: 'not-found'; title: string }
  | { kind: 'can-accept'; title: string }
  | { kind: 'already-member'; title: string }
  | { kind: 'email-mismatch'; title: string }
  | { kind: 'consumed'; title: string }
  | { kind: 'expired'; title: string }
  | { kind: 'revoked'; title: string }
  | { kind: 'blocked'; title: string };

export function inviteModeLabel(mode: InviteMode): string {
  return mode === 'open' ? msg('Offener Einmal-Link') : msg('Persönlicher E-Mail-Link');
}

export function inviteRoleLabel(role: InviteRole): string {
  return role === 'admin' ? msg('Admin') : msg('Mitglied');
}

// Returns a msg()-encoded string — translate it at the call site with useMessages().
export function buildInviteShareMessage(input: {
  circleName: string;
  inviteLink: string;
  code: string;
  mode: InviteMode;
}): string {
  const variables = {
    circleName: input.circleName,
    inviteLink: input.inviteLink,
    code: input.code,
  };

  if (input.mode === 'open') {
    return msg(
      'Komm in meinen Circle "{circleName}": {inviteLink}\n\nOder gib in der App diesen Code ein: {code}\n\nDieser Link ist einmalig nutzbar.',
      variables,
    );
  }

  return msg(
    'Komm in meinen Circle "{circleName}": {inviteLink}\n\nOder gib in der App diesen Code ein: {code}\n\nDieser persönliche Link ist nur für die eingeladene E-Mail gedacht.',
    variables,
  );
}

export function resolveInvitePreviewState(input: {
  preview: InvitePreviewLike | null | undefined;
}): InvitePreviewState {
  const preview = input.preview;

  if (preview === undefined) {
    return { kind: 'loading', title: msg('Einladung wird geladen') };
  }

  if (preview === null) {
    return { kind: 'not-found', title: msg('Einladung nicht gefunden') };
  }

  if (preview.isAlreadyMember && preview.status === 'pending') {
    return { kind: 'already-member', title: msg('Du bist schon Mitglied') };
  }

  switch (preview.status) {
    case 'accepted':
      return { kind: 'consumed', title: msg('Einladung wurde bereits verwendet') };
    case 'expired':
      return { kind: 'expired', title: msg('Einladung ist abgelaufen') };
    case 'revoked':
      return { kind: 'revoked', title: msg('Einladung wurde zurückgezogen') };
    default:
      break;
  }

  if (!preview.emailMatchesViewer) {
    return { kind: 'email-mismatch', title: msg('E-Mail passt nicht') };
  }

  if (preview.canAccept) {
    return { kind: 'can-accept', title: msg('Einladung annehmen') };
  }

  return { kind: 'blocked', title: msg('Einladung kann nicht angenommen werden') };
}
