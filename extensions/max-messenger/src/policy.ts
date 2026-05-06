/**
 * Group policy helpers (Phase 3 — `groups.resolveRequireMention` and
 * `groups.resolveToolPolicy`).
 *
 * MAX has no per-room config in the schema today — Phase 3+ may add a
 * `channels.max-messenger.rooms[<chatId>]` map analogous to nextcloud-talk.
 * Until then both helpers fall back to channel-wide defaults so groups in
 * MAX behave like every other allowlist-driven channel without surprising
 * operators.
 */

import type { ChannelGroupContext, GroupToolPolicyConfig } from "./runtime-api.js";

/**
 * Default to `true` in groups so the agent only replies when explicitly
 * mentioned. Operators who want unconditional group replies can opt out by
 * setting `agents.<id>.groups.requireMention: false` in core config.
 */
export function resolveMaxRequireMention(_ctx: ChannelGroupContext): boolean | undefined {
  return true;
}

/**
 * No per-room tool-policy override today — `undefined` lets the SDK fall
 * back to the agent-level policy. Wires into the channel plugin so the
 * group adapter shape is complete for future per-room tightening.
 */
export function resolveMaxGroupToolPolicy(
  _ctx: ChannelGroupContext,
): GroupToolPolicyConfig | undefined {
  return undefined;
}
