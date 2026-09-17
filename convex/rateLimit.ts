import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';

import { components } from './_generated/api';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  waitlistJoinByIp: {
    kind: 'fixed window',
    rate: 5,
    period: MINUTE,
    capacity: 10,
  },
  waitlistJoinGlobal: {
    kind: 'fixed window',
    rate: 200,
    period: MINUTE,
  },
  // Invite codes are short (50 bits) so lookups and accepts are throttled
  // per user; a real person previews a handful of invites, never hundreds.
  inviteLookupByUser: {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 30,
  },
  inviteAcceptByUser: {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
});
