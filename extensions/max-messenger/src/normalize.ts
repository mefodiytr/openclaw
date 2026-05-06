/**
 * Pure normalization helpers for the MAX channel — kept free of any
 * `openclaw/plugin-sdk/*` import that would drag the heavy reply pipeline
 * into hot paths. The messaging adapter and outbound parser import from
 * here; the inbound dispatcher re-exports `normalizeMaxInboundMessage` for
 * external callers.
 *
 * MAX targets are integer `chat_id`s. We accept user-supplied identifiers
 * with or without a `max:` / `max-messenger:` prefix and normalize to a
 * canonical bare-integer string. Mirrors the
 * `normalizeNextcloudTalkMessagingTarget` / `looksLikeNextcloudTalkTargetId`
 * shape from `extensions/nextcloud-talk/src/normalize.ts`.
 */

import type { MaxCallbackEvent, MaxInboundMessage } from "./types.js";

const PREFIX_RE = /^(max-messenger|max):/iu;
const INTEGER_RE = /^-?\d+$/u;

/** Strip channel prefix and trim, returning a bare candidate string. */
export function normalizeMaxMessagingTarget(input: string): string {
  return input.trim().replace(PREFIX_RE, "");
}

/** True if the input parses cleanly as a MAX `chat_id`. */
export function looksLikeMaxTargetId(input: string): boolean {
  const candidate = normalizeMaxMessagingTarget(input);
  return INTEGER_RE.test(candidate);
}

function trimToOptional(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalize a raw `PollingUpdate` from the supervisor into the
 * `MaxInboundMessage` shape the dispatcher expects. Returns `null` when the
 * update is not a `message_created` event with a usable body / chat / sender.
 *
 * Pure function — no SDK imports. Keep it that way so test suites that only
 * exercise the normalizer don't pull the agent reply pipeline.
 */
export function normalizeMaxInboundMessage(update: {
  update_type: string;
  timestamp?: number;
  message?: {
    sender?: { user_id?: number; first_name?: string; last_name?: string } | null;
    recipient?: { chat_id?: number; chat_type?: string } | null;
    timestamp?: number;
    body?: { mid?: string | null; text?: string | null } | null;
    link?: { type?: string; message?: { mid?: string } } | null;
  } | null;
}): MaxInboundMessage | null {
  if (update.update_type !== "message_created" || !update.message) {
    return null;
  }
  const message = update.message;
  const mid = message.body?.mid;
  const chatIdNum = message.recipient?.chat_id;
  const senderUserId = message.sender?.user_id;
  if (!mid || typeof chatIdNum !== "number" || typeof senderUserId !== "number") {
    return null;
  }
  const text = message.body?.text ?? "";
  const chatType = message.recipient?.chat_type ?? "dialog";
  const isGroupChat = chatType !== "dialog";
  const firstName = trimToOptional(message.sender?.first_name);
  const lastName = trimToOptional(message.sender?.last_name);
  const senderName = [firstName, lastName].filter(Boolean).join(" ") || `user:${senderUserId}`;
  const replyMid =
    message.link && message.link.type === "reply" ? message.link.message?.mid : undefined;
  return {
    messageId: mid,
    chatId: String(chatIdNum),
    chatTitle: undefined,
    senderId: String(senderUserId),
    senderName,
    text,
    timestamp: typeof message.timestamp === "number" ? message.timestamp : (update.timestamp ?? 0),
    isGroupChat,
    replyToMessageId: replyMid ?? undefined,
  };
}

/**
 * Normalize a `message_callback` update into the `MaxCallbackEvent` shape
 * the dispatcher expects. Returns `null` when the update is not a callback
 * with a usable callback_id / sender / chat reference.
 *
 * Pure function — no SDK imports.
 */
export function normalizeMaxCallbackEvent(update: {
  update_type: string;
  timestamp?: number;
  callback?: {
    callback_id?: string | null;
    payload?: string | null;
    timestamp?: number;
    user?: { user_id?: number; first_name?: string; last_name?: string } | null;
  } | null;
  message?: {
    recipient?: { chat_id?: number; chat_type?: string } | null;
    body?: { mid?: string | null } | null;
  } | null;
}): MaxCallbackEvent | null {
  if (update.update_type !== "message_callback" || !update.callback) {
    return null;
  }
  const callback = update.callback;
  const callbackId = callback.callback_id;
  const userId = callback.user?.user_id;
  const chatIdNum = update.message?.recipient?.chat_id;
  if (!callbackId || typeof userId !== "number" || typeof chatIdNum !== "number") {
    return null;
  }
  const firstName = trimToOptional(callback.user?.first_name);
  const lastName = trimToOptional(callback.user?.last_name);
  const senderName = [firstName, lastName].filter(Boolean).join(" ") || `user:${userId}`;
  const chatType = update.message?.recipient?.chat_type ?? "dialog";
  return {
    callbackId,
    payload: callback.payload ?? undefined,
    senderId: String(userId),
    senderName,
    chatId: String(chatIdNum),
    isGroupChat: chatType !== "dialog",
    parentMessageId: update.message?.body?.mid ?? undefined,
    timestamp:
      typeof callback.timestamp === "number" ? callback.timestamp : (update.timestamp ?? 0),
  };
}
