import { describe, expect, test } from 'vitest';

import {
  buildInviteShareMessage,
  resolveInvitePreviewState,
} from './preview-state';

describe('invite preview state', () => {
  test('lets open pending invites be accepted by non-members', () => {
    expect(
      resolveInvitePreviewState({
        preview: {
          mode: 'open',
          invitedEmail: null,
          status: 'pending',
          canAccept: true,
          emailMatchesViewer: true,
          isAlreadyMember: false,
        },
      }),
    ).toEqual({
      kind: 'can-accept',
      title: 'Einladung annehmen',
    });
  });

  test('blocks email-bound invites when the active account differs', () => {
    expect(
      resolveInvitePreviewState({
        preview: {
          mode: 'email',
          invitedEmail: 'friend@example.com',
          status: 'pending',
          canAccept: false,
          emailMatchesViewer: false,
          isAlreadyMember: false,
        },
      }).kind,
    ).toBe('email-mismatch');
  });

  test('shows consumed open links as already used', () => {
    expect(
      resolveInvitePreviewState({
        preview: {
          mode: 'open',
          invitedEmail: null,
          status: 'accepted',
          canAccept: false,
          emailMatchesViewer: true,
          isAlreadyMember: false,
        },
      }).kind,
    ).toBe('consumed');
  });

  test('builds different share copy for email and open invites', () => {
    expect(
      buildInviteShareMessage({
        circleName: 'Familie',
        inviteLink: 'beisammen://connect?invite=abc',
        code: 'K7MF3-QX9WD',
        mode: 'email',
      }),
    ).toContain('persönlich');
    expect(
      buildInviteShareMessage({
        circleName: 'Familie',
        inviteLink: 'beisammen://connect?invite=abc',
        code: 'K7MF3-QX9WD',
        mode: 'open',
      }),
    ).toContain('einmalig');
  });
});
