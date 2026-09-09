type EnvSource = Record<string, string | undefined>;

// Invite links must be real https URLs so chat apps (WhatsApp, iMessage, …)
// render them as tappable links. The website's /connect page hands the
// parameters over to the app (Universal Link / App Link when the app is
// installed, otherwise a fallback page with store badges).
export const DEFAULT_INVITE_LINK_BASE_URL = 'https://beisammen.app';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function readInviteLinkBaseUrl(env: EnvSource = process.env): string {
  const configured = env.PUBLIC_INVITE_LINK_BASE_URL?.trim();
  return trimTrailingSlashes(configured || DEFAULT_INVITE_LINK_BASE_URL);
}

export function buildInviteLink(input: {
  token: string;
  instanceBaseUrl: string;
  env?: EnvSource;
}): string {
  const params = new URLSearchParams({
    instance: trimTrailingSlashes(input.instanceBaseUrl),
    invite: input.token,
  });

  return `${readInviteLinkBaseUrl(input.env)}/connect?${params.toString()}`;
}
