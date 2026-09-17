import { normalizeInviteCode } from '@beisammen/contracts';

/**
 * Accepts a raw invite code (`K7MF3-QX9WD`, any case, with or without the
 * separator), a legacy UUID token, an invite link
 * (`https://beisammen.app/connect?invite=...` or the legacy
 * `beisammen://connect?invite=...`), or a pasted share message containing
 * such a link. Short codes come back in their canonical form.
 */
export function parseInviteToken(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const paramMatch = trimmed.match(/[?&]invite=([^&\s]+)/);

  if (paramMatch?.[1]) {
    let token = paramMatch[1];

    try {
      token = decodeURIComponent(token);
    } catch {
      // Keep the raw parameter when it is not valid percent-encoding.
    }

    return normalizeInviteCode(token) ?? token;
  }

  const asCode = normalizeInviteCode(trimmed);

  if (asCode) {
    return asCode;
  }

  if (/\s/.test(trimmed)) {
    const linkMatch = trimmed.match(/(?:beisammen|https?):\/\/\S+/);
    return linkMatch ? parseInviteToken(linkMatch[0]) : null;
  }

  if (trimmed.includes('://')) {
    return null;
  }

  return trimmed;
}
