import { describe, expect, test } from 'vitest';

import { buildInviteLink, readInviteLinkBaseUrl } from './lib/inviteLinks';

describe('invite links', () => {
  test('builds an https link on the public website by default', () => {
    expect(
      buildInviteLink({
        token: 'tok-1',
        instanceBaseUrl: 'https://backend.beisammen.app/',
        env: {},
      }),
    ).toBe(
      'https://beisammen.app/connect?instance=https%3A%2F%2Fbackend.beisammen.app&invite=tok-1',
    );
  });

  test('honors a configured website base URL', () => {
    expect(readInviteLinkBaseUrl({ PUBLIC_INVITE_LINK_BASE_URL: 'https://example.org/' })).toBe(
      'https://example.org',
    );
    expect(
      buildInviteLink({
        token: 'abc',
        instanceBaseUrl: 'https://home.example.com',
        env: { PUBLIC_INVITE_LINK_BASE_URL: 'https://example.org/' },
      }),
    ).toBe('https://example.org/connect?instance=https%3A%2F%2Fhome.example.com&invite=abc');
  });

  test('ignores a blank override', () => {
    expect(readInviteLinkBaseUrl({ PUBLIC_INVITE_LINK_BASE_URL: '   ' })).toBe(
      'https://beisammen.app',
    );
  });
});
