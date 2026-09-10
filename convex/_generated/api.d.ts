/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as activity from "../activity.js";
import type * as admin from "../admin.js";
import type * as appConfig from "../appConfig.js";
import type * as assets from "../assets.js";
import type * as billing from "../billing.js";
import type * as billingRetention from "../billingRetention.js";
import type * as billingUsage from "../billingUsage.js";
import type * as circleStats from "../circleStats.js";
import type * as circles from "../circles.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as keys from "../keys.js";
import type * as legacyStorage from "../legacyStorage.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_billing_plans from "../lib/billing/plans.js";
import type * as lib_billing_quota from "../lib/billing/quota.js";
import type * as lib_engagement from "../lib/engagement.js";
import type * as lib_expoPush from "../lib/expoPush.js";
import type * as lib_httpHelpers from "../lib/httpHelpers.js";
import type * as lib_instance from "../lib/instance.js";
import type * as lib_inviteLinks from "../lib/inviteLinks.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_shareAssets from "../lib/shareAssets.js";
import type * as lib_storage_s3 from "../lib/storage/s3.js";
import type * as lib_storage_shared from "../lib/storage/shared.js";
import type * as lib_uploadLimits from "../lib/uploadLimits.js";
import type * as lib_viewer from "../lib/viewer.js";
import type * as mediaCleanup from "../mediaCleanup.js";
import type * as memories from "../memories.js";
import type * as notifications from "../notifications.js";
import type * as rateLimit from "../rateLimit.js";
import type * as reactions from "../reactions.js";
import type * as revenuecat from "../revenuecat.js";
import type * as shares from "../shares.js";
import type * as storageStats from "../storageStats.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  activity: typeof activity;
  admin: typeof admin;
  appConfig: typeof appConfig;
  assets: typeof assets;
  billing: typeof billing;
  billingRetention: typeof billingRetention;
  billingUsage: typeof billingUsage;
  circleStats: typeof circleStats;
  circles: typeof circles;
  comments: typeof comments;
  crons: typeof crons;
  email: typeof email;
  http: typeof http;
  invites: typeof invites;
  keys: typeof keys;
  legacyStorage: typeof legacyStorage;
  "lib/activity": typeof lib_activity;
  "lib/billing/plans": typeof lib_billing_plans;
  "lib/billing/quota": typeof lib_billing_quota;
  "lib/engagement": typeof lib_engagement;
  "lib/expoPush": typeof lib_expoPush;
  "lib/httpHelpers": typeof lib_httpHelpers;
  "lib/instance": typeof lib_instance;
  "lib/inviteLinks": typeof lib_inviteLinks;
  "lib/notifications": typeof lib_notifications;
  "lib/permissions": typeof lib_permissions;
  "lib/shareAssets": typeof lib_shareAssets;
  "lib/storage/s3": typeof lib_storage_s3;
  "lib/storage/shared": typeof lib_storage_shared;
  "lib/uploadLimits": typeof lib_uploadLimits;
  "lib/viewer": typeof lib_viewer;
  mediaCleanup: typeof mediaCleanup;
  memories: typeof memories;
  notifications: typeof notifications;
  rateLimit: typeof rateLimit;
  reactions: typeof reactions;
  revenuecat: typeof revenuecat;
  shares: typeof shares;
  storageStats: typeof storageStats;
  uploads: typeof uploads;
  users: typeof users;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  revenuecat: import("convex-revenuecat/_generated/component.js").ComponentApi<"revenuecat">;
};
