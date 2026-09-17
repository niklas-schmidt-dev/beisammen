import { v } from 'convex/values';

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  normalizeInviteCode,
} from '@beisammen/contracts';

import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { adjustCircleStats } from './circleStats';
import { createActivityEventWithInbox } from './lib/activity';
import { readBaseUrl } from './lib/httpHelpers';
import { buildInviteLink } from './lib/inviteLinks';
import { isManageRole, requireCircleMembership, requireViewer } from './lib/viewer';
import { rateLimiter } from './rateLimit';

export const CIRCLE_INVITE_LIST_LIMIT = 100;
type InviteMode = 'email' | 'open';

const inviteModeValidator = v.union(v.literal('email'), v.literal('open'));

function buildInvitedByLabel(user: Doc<'users'> | null) {
  if (!user) {
    return 'Unbekannte Person';
  }

  return user.displayName?.trim() || user.email?.trim() || 'Unbekannte Person';
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function inviteMode(invite: Doc<'invites'>): InviteMode {
  return invite.mode ?? 'email';
}

function normalizedInviteEmail(invite: Doc<'invites'>): string | null {
  return invite.invitedEmail?.trim().toLowerCase() || null;
}

async function findCircleMembership(
  ctx: QueryCtx | MutationCtx,
  input: {
    circleId: Doc<'invites'>['circleId'];
    userId: Doc<'users'>['_id'];
  },
) {
  return await ctx.db
    .query('circleMembers')
    .withIndex('by_circle_and_user', (q) =>
      q.eq('circleId', input.circleId).eq('userId', input.userId),
    )
    .unique();
}

async function mapAcceptedBy(
  ctx: QueryCtx | MutationCtx,
  acceptedBy?: Doc<'users'>['_id'],
) {
  if (!acceptedBy) {
    return null;
  }

  const user = await ctx.db.get(acceptedBy);

  return {
    userId: acceptedBy,
    displayName: buildInvitedByLabel(user),
  };
}

async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token.trim()),
  );

  return `sha256:${toHex(digest)}`;
}

/**
 * Mints a short invite code from the Crockford alphabet using rejection
 * sampling, so every symbol is uniformly distributed.
 */
function generateInviteCode(): string {
  const symbols: string[] = [];
  const bytes = new Uint8Array(INVITE_CODE_LENGTH * 2);

  while (symbols.length < INVITE_CODE_LENGTH) {
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      // 256 is not a multiple of 32; skip the tail so no symbol is favored.
      if (byte >= 224) {
        continue;
      }

      symbols.push(INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length]);

      if (symbols.length === INVITE_CODE_LENGTH) {
        break;
      }
    }
  }

  return symbols.join('');
}

/**
 * Short codes are matched in their canonical form regardless of how they were
 * typed; legacy UUID tokens are matched verbatim.
 */
function canonicalInviteToken(token: string): string {
  return normalizeInviteCode(token) ?? token.trim();
}

async function findInviteByToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<'invites'> | null> {
  const normalizedToken = canonicalInviteToken(token);

  if (!normalizedToken) {
    return null;
  }

  const hashedToken = await hashInviteToken(normalizedToken);
  const hashedInvite = await ctx.db
    .query('invites')
    .withIndex('by_token_hash', (q) => q.eq('tokenHash', hashedToken))
    .unique();

  if (hashedInvite) {
    return hashedInvite;
  }

  return await ctx.db
    .query('invites')
    .withIndex('by_token_hash', (q) => q.eq('tokenHash', normalizedToken))
    .unique();
}

export const create = mutation({
  args: {
    circleId: v.id('circles'),
    mode: v.optional(inviteModeValidator),
    invitedEmail: v.optional(v.string()),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);

    if (!isManageRole(membership.role)) {
      throw new Error('Only owners and admins can invite people.');
    }

    const now = Date.now();
    const mode = args.mode ?? 'email';
    const invitedEmail = args.invitedEmail?.trim().toLowerCase() ?? '';

    if (mode === 'email' && !invitedEmail) {
      throw new Error('Invited email is required for email-bound invites.');
    }

    const token = generateInviteCode();
    const tokenHash = await hashInviteToken(token);
    const inviteId = await ctx.db.insert('invites', {
      circleId: args.circleId,
      mode,
      ...(mode === 'email' ? { invitedEmail } : {}),
      role: args.role,
      tokenHash,
      status: 'pending',
      invitedBy: viewer._id,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    return {
      inviteId,
      token,
      code: formatInviteCode(token),
      inviteLink: buildInviteLink({ token, instanceBaseUrl: readBaseUrl() }),
    };
  },
});

export const listForCircle = query({
  args: {
    circleId: v.id('circles'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const membership = await requireCircleMembership(ctx, viewer._id, args.circleId);
    const invites = await ctx.db
      .query('invites')
      .withIndex('by_circle_and_expires_at', (q) => q.eq('circleId', args.circleId))
      .order('desc')
      .take(CIRCLE_INVITE_LIST_LIMIT);

    const rows = await Promise.all(
      invites.map(async (invite) => {
        const [inviter, acceptedBy] = await Promise.all([
          ctx.db.get(invite.invitedBy),
          mapAcceptedBy(ctx, invite.acceptedBy),
        ]);
        const isExpired = invite.status === 'pending' && invite.expiresAt < Date.now();
        const resolvedStatus = isExpired ? 'expired' : invite.status;
        const mode = inviteMode(invite);

        return {
          _id: invite._id,
          circleId: invite.circleId,
          mode,
          invitedEmail: mode === 'email' ? normalizedInviteEmail(invite) : null,
          role: invite.role,
          status: resolvedStatus,
          expiresAt: invite.expiresAt,
          acceptedAt: invite.acceptedAt ?? null,
          acceptedBy,
          invitedBy: {
            userId: invite.invitedBy,
            displayName: buildInvitedByLabel(inviter),
          },
          canRevoke: isManageRole(membership.role) && resolvedStatus === 'pending',
        };
      }),
    );

    return rows.sort((left, right) => right.expiresAt - left.expiresAt);
  },
});

export const preview = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    // Queries cannot consume tokens; check the viewer's budget read-only so
    // a guessing loop sees the same wall as accept() does.
    const lookupBudget = await rateLimiter.check(ctx, 'inviteLookupByUser', {
      key: viewer._id,
    });

    if (!lookupBudget.ok) {
      throw new Error('Zu viele Versuche. Bitte warte kurz und versuche es erneut.');
    }

    const invite = await findInviteByToken(ctx, args.token);

    if (!invite) {
      return null;
    }

    const circle = await ctx.db.get(invite.circleId);

    if (!circle) {
      return null;
    }

    const status =
      invite.status === 'pending' && invite.expiresAt < Date.now() ? 'expired' : invite.status;
    const mode = inviteMode(invite);
    const viewerEmail = viewer.email?.trim().toLowerCase();
    const invitedEmail = normalizedInviteEmail(invite);
    const emailMatchesViewer =
      mode === 'open' ? true : Boolean(viewerEmail && invitedEmail && viewerEmail === invitedEmail);
    const existingMembership = await findCircleMembership(ctx, {
      circleId: invite.circleId,
      userId: viewer._id,
    });

    return {
      inviteId: invite._id,
      circleId: invite.circleId,
      circleName: circle.name,
      mode,
      invitedEmail: mode === 'email' ? invitedEmail : null,
      role: invite.role,
      status,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt ?? null,
      acceptedBy: await mapAcceptedBy(ctx, invite.acceptedBy),
      canAccept: status === 'pending' && !existingMembership && emailMatchesViewer,
      emailMatchesViewer,
      isAlreadyMember: Boolean(existingMembership),
    };
  },
});

export const accept = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    // Every accept attempt spends from both budgets: the lookup one so
    // guessed codes are charged even when they miss, the accept one so a
    // valid code cannot be replayed in a tight loop.
    const lookupBudget = await rateLimiter.limit(ctx, 'inviteLookupByUser', {
      key: viewer._id,
    });
    const acceptBudget = await rateLimiter.limit(ctx, 'inviteAcceptByUser', {
      key: viewer._id,
    });

    if (!lookupBudget.ok || !acceptBudget.ok) {
      throw new Error('Zu viele Versuche. Bitte warte kurz und versuche es erneut.');
    }

    const invite = await findInviteByToken(ctx, args.token);

    // A miss returns instead of throwing: a thrown mutation is rolled back,
    // which would also refund the rate-limit tokens a wrong guess just spent.
    if (!invite) {
      return { status: 'not_found' as const };
    }

    if (invite.status !== 'pending') {
      throw new Error('Invite is no longer pending.');
    }

    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, {
        status: 'expired',
      });
      throw new Error('Invite has expired.');
    }

    const existingMembership = await findCircleMembership(ctx, {
      circleId: invite.circleId,
      userId: viewer._id,
    });

    if (existingMembership) {
      throw new Error('You are already a member of this circle.');
    }

    const mode = inviteMode(invite);
    const invitedEmail = normalizedInviteEmail(invite);
    const viewerEmail = viewer.email?.trim().toLowerCase();

    if (mode === 'email' && (!viewerEmail || viewerEmail !== invitedEmail)) {
      throw new Error('Invite email does not match the current account.');
    }

    const now = Date.now();

    await ctx.db.insert('circleMembers', {
      circleId: invite.circleId,
      userId: viewer._id,
      role: invite.role,
      joinedAt: now,
    });
    await adjustCircleStats(ctx, invite.circleId, {
      memberCount: 1,
    });
    await ctx.db.patch(invite._id, {
      status: 'accepted',
      acceptedAt: now,
      acceptedBy: viewer._id,
    });
    // Existing members learn about the newcomer; the joiner's own row is
    // pre-read like every actor self-event.
    await createActivityEventWithInbox(ctx, {
      circleId: invite.circleId,
      actorId: viewer._id,
      type: 'member.joined',
      createdAt: now,
    });

    return {
      status: 'accepted' as const,
      inviteId: invite._id,
      circleId: invite.circleId,
    };
  },
});

export const revoke = mutation({
  args: {
    inviteId: v.id('invites'),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const invite = await ctx.db.get(args.inviteId);

    if (!invite) {
      throw new Error('Invite not found.');
    }

    const membership = await requireCircleMembership(ctx, viewer._id, invite.circleId);

    if (!isManageRole(membership.role)) {
      throw new Error('Only owners and admins can revoke invites.');
    }

    await ctx.db.patch(invite._id, {
      status: 'revoked',
    });

    return {
      inviteId: invite._id,
    };
  },
});
