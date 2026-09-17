import { describe, expect, test } from 'vitest';

import { parseInviteToken } from '@/features/invites/parse-invite-token';

describe('parseInviteToken', () => {
  test('accepts a raw token', () => {
    expect(parseInviteToken('  abc123  ')).toBe('abc123');
  });

  test('extracts the token from a connect link', () => {
    expect(parseInviteToken('beisammen://connect?invite=abc123')).toBe('abc123');
    expect(
      parseInviteToken('beisammen://connect?instance=https%3A%2F%2Fhome.example.com&invite=tok-1'),
    ).toBe('tok-1');
  });

  test('extracts the token from an https invite link', () => {
    expect(
      parseInviteToken(
        'https://beisammen.app/connect?instance=https%3A%2F%2Fbackend.beisammen.app&invite=b02067d6',
      ),
    ).toBe('b02067d6');
  });

  test('extracts the link from a pasted share message', () => {
    expect(
      parseInviteToken('Komm in meinen Circle "Familie": beisammen://connect?invite=xyz\n\nBis bald!'),
    ).toBe('xyz');
    expect(
      parseInviteToken(
        'Komm in meinen Circle "Familie": https://beisammen.app/connect?instance=https%3A%2F%2Fbackend.beisammen.app&invite=tok-9\n\nDieser Link ist einmalig nutzbar.',
      ),
    ).toBe('tok-9');
  });

  test('normalizes short codes however they were typed', () => {
    expect(parseInviteToken('k7mf3-qx9wd')).toBe('K7MF3QX9WD');
    expect(parseInviteToken('K7MF3 QX9WD')).toBe('K7MF3QX9WD');
    expect(parseInviteToken('k7mf3-qxOwd')).toBe('K7MF3QX0WD');
    expect(parseInviteToken('https://beisammen.app/connect?invite=k7mf3-qx9wd')).toBe('K7MF3QX9WD');
    expect(
      parseInviteToken('Komm in meinen Circle "Familie": https://beisammen.app/connect?invite=K7MF3QX9WD\n\nCode: K7MF3-QX9WD'),
    ).toBe('K7MF3QX9WD');
  });

  test('rejects unrelated URLs and empty input', () => {
    expect(parseInviteToken('https://example.com/some-page')).toBeNull();
    expect(parseInviteToken('   ')).toBeNull();
    expect(parseInviteToken('zwei wörter ohne link')).toBeNull();
  });
});
