/**
 * Outbound send helpers for the MAX channel. Shared between the outbound
 * adapter (agent → channel reply path), the inbound dispatcher's deliver
 * callback (pairing replies, agent reply chunks), and the message_callback
 * handler (acknowledging button presses).
 *
 * Issues `POST /messages?chat_id=<n>` through the same `pollingHttpRequest`
 * wrapper the supervisor uses, so outbound inherits Retry-After honoring,
 * 401 classification, and per-request timeout — per
 * docs/max-plugin/plan.md §6.1.6 ("Reused for non-polling MAX API calls").
 *
 * Phase 3 adds optional `attachments[]` for inline keyboards (callback /
 * link / contact / location / chat buttons). The helper accepts a
 * `MaxOutboundButton` matrix (`[[btn, btn], [btn]]`) and serializes it
 * into the SDK's `InlineKeyboardAttachmentRequest` shape.
 *
 * Phase 4 adds `sendMaxMedia` for outbound media. For images with a public
 * `http(s)://` URL we use MAX's URL shortcut (`payload.url`); for everything
 * else we download bytes via `loadOutboundMediaFromUrl` (so SSRF / local-roots
 * policy is honored) and run the two-step upload from `attachments.ts`.
 */

import {
  loadOutboundMediaFromUrl,
  type OutboundMediaLoadOptions,
} from "openclaw/plugin-sdk/outbound-media";
import { resolveMaxAccount } from "./account-resolver.js";
import {
  uploadAndBuildAttachment,
  type MaxAttachmentType,
  type MaxOutboundAttachment,
} from "./attachments.js";
import { pollingHttpRequest, UnauthorizedError } from "./polling/polling-http.js";
import type { CoreConfig } from "./types.js";

const SEND_REQUEST_TIMEOUT_MS = 30_000;

type SendMessageResponse = {
  message?: {
    body?: {
      mid?: string;
    };
  };
};

/** Strip optional `max:` / `max-messenger:` prefix and parse to integer chat_id. */
export function parseChatId(to: string): number {
  const trimmed = to.trim().replace(/^max(-messenger)?:/iu, "");
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `MAX Messenger: outbound target "${to}" is not a valid chat_id (expected integer).`,
    );
  }
  return parsed;
}

export type MaxOutboundButton =
  | {
      type: "callback";
      text: string;
      payload: string;
      intent?: "default" | "positive" | "negative";
    }
  | { type: "link"; text: string; url: string }
  | { type: "request_contact"; text: string }
  | { type: "request_geo_location"; text: string; quick?: boolean }
  | {
      type: "chat";
      text: string;
      chat_title: string;
      chat_description?: string;
      start_payload?: string;
    };

type InlineKeyboardAttachment = {
  type: "inline_keyboard";
  payload: { buttons: MaxOutboundButton[][] };
};

/**
 * Serialize a button matrix into the SDK's `InlineKeyboardAttachmentRequest`
 * shape. Returns `undefined` when the matrix is empty so callers can omit
 * `attachments[]` entirely instead of sending an empty array.
 */
export function buildInlineKeyboardAttachment(
  buttons: ReadonlyArray<ReadonlyArray<MaxOutboundButton>> | undefined,
): InlineKeyboardAttachment | undefined {
  if (!buttons || buttons.length === 0) {
    return undefined;
  }
  const nonEmpty: MaxOutboundButton[][] = [];
  for (const row of buttons) {
    if (row.length > 0) {
      nonEmpty.push(Array.from(row));
    }
  }
  if (nonEmpty.length === 0) {
    return undefined;
  }
  return {
    type: "inline_keyboard",
    payload: { buttons: nonEmpty },
  };
}

export type SendMaxTextParams = {
  cfg: CoreConfig;
  to: string;
  accountId?: string | null;
  text: string;
  /** Optional reply-to message id for native quote threading. */
  replyToId?: string | null;
  /** Optional inline keyboard buttons (rows of buttons). Empty matrix → no keyboard. */
  buttons?: ReadonlyArray<ReadonlyArray<MaxOutboundButton>>;
  /** Pre-built outbound media attachments (image URL shortcut or upload tokens). */
  mediaAttachments?: ReadonlyArray<MaxOutboundAttachment>;
};

/** Resolve account, parse target, send `POST /messages`, return the new mid. */
export async function sendMaxText(params: SendMaxTextParams): Promise<{ messageId: string }> {
  const account = resolveMaxAccount({
    cfg: params.cfg,
    accountId: params.accountId ?? null,
  });
  if (!account.token) {
    throw new Error(
      `MAX Messenger: no token available for account "${account.accountId}"; ` +
        "configure channels.max-messenger.token / tokenFile / MAX_BOT_TOKEN.",
    );
  }
  const chatId = parseChatId(params.to);

  const attachments: Array<InlineKeyboardAttachment | MaxOutboundAttachment> = [];
  if (params.mediaAttachments && params.mediaAttachments.length > 0) {
    attachments.push(...params.mediaAttachments);
  }
  const keyboard = buildInlineKeyboardAttachment(params.buttons);
  if (keyboard) {
    attachments.push(keyboard);
  }

  const body: {
    text: string;
    link?: { type: "reply"; mid: string };
    attachments?: Array<InlineKeyboardAttachment | MaxOutboundAttachment>;
  } = { text: params.text };
  if (params.replyToId && params.replyToId.trim() !== "") {
    body.link = { type: "reply", mid: params.replyToId };
  }
  if (attachments.length > 0) {
    body.attachments = attachments;
  }

  try {
    const response = await pollingHttpRequest<SendMessageResponse>({
      apiRoot: account.apiRoot,
      path: "/messages",
      method: "POST",
      token: account.token,
      query: { chat_id: chatId },
      body,
      requestTimeoutMs: SEND_REQUEST_TIMEOUT_MS,
    });
    const mid = response.message?.body?.mid;
    return {
      messageId: typeof mid === "string" && mid !== "" ? mid : `max-send-${Date.now()}`,
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw new Error(
        `MAX Messenger: token for account "${account.accountId}" was rejected by the API (HTTP 401).`,
        { cause: err },
      );
    }
    throw err;
  }
}

const DEFAULT_MEDIA_MAX_MB = 50;

function classifyAttachmentType(
  hint: MaxAttachmentType | undefined,
  contentType: string | undefined,
  kind: "image" | "audio" | "video" | "document" | undefined,
): MaxAttachmentType {
  if (hint) {
    return hint;
  }
  if (kind === "image" || kind === "audio" || kind === "video") {
    return kind;
  }
  if (contentType?.startsWith("image/")) {
    return "image";
  }
  if (contentType?.startsWith("audio/")) {
    return "audio";
  }
  if (contentType?.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function isPublicHttpUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    const last = segments.findLast((s) => s.length > 0);
    if (last) {
      return last;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export type SendMaxMediaParams = {
  cfg: CoreConfig;
  to: string;
  accountId?: string | null;
  /** Optional caption text. */
  text?: string;
  /** Public URL or `MEDIA:<path>` reference resolved via `mediaAccess`. */
  mediaUrl: string;
  /** Force a specific MAX attachment type. Inferred from content-type when absent. */
  attachmentType?: MaxAttachmentType;
  replyToId?: string | null;
  buttons?: ReadonlyArray<ReadonlyArray<MaxOutboundButton>>;
  /** Outbound media access (workspace dir / read file capability). */
  mediaAccess?: OutboundMediaLoadOptions["mediaAccess"];
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
  /** Cap bytes when fetching from URL. Defaults to `account.config.mediaMaxMb * 1024^2` or 50MB. */
  maxBytes?: number;
};

/**
 * Send a media attachment to a MAX chat.
 *
 * Routing:
 *   - `image` + public `http(s)://` URL → URL shortcut (MAX fetches server-side).
 *   - everything else → load bytes via `loadOutboundMediaFromUrl` (honors
 *     SSRF + local-roots policy), then run the two-step upload flow from
 *     `attachments.ts`.
 */
export async function sendMaxMedia(params: SendMaxMediaParams): Promise<{ messageId: string }> {
  const account = resolveMaxAccount({
    cfg: params.cfg,
    accountId: params.accountId ?? null,
  });
  if (!account.token) {
    throw new Error(
      `MAX Messenger: no token available for account "${account.accountId}"; ` +
        "configure channels.max-messenger.token / tokenFile / MAX_BOT_TOKEN.",
    );
  }
  if (!params.mediaUrl || params.mediaUrl.trim() === "") {
    throw new Error("MAX Messenger: sendMaxMedia called without mediaUrl.");
  }

  const isPublicUrl = isPublicHttpUrl(params.mediaUrl);
  const wantImage = params.attachmentType === "image";

  let attachment: MaxOutboundAttachment;
  if (wantImage && isPublicUrl) {
    attachment = { type: "image", payload: { url: params.mediaUrl.trim() } };
  } else {
    const maxBytes =
      params.maxBytes ?? (account.config.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB) * 1024 * 1024;
    const loaded = await loadOutboundMediaFromUrl(params.mediaUrl, {
      maxBytes,
      ...(params.mediaAccess ? { mediaAccess: params.mediaAccess } : {}),
      ...(params.mediaLocalRoots ? { mediaLocalRoots: params.mediaLocalRoots } : {}),
      ...(params.mediaReadFile ? { mediaReadFile: params.mediaReadFile } : {}),
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
    const type = classifyAttachmentType(params.attachmentType, loaded.contentType, loaded.kind);
    if (type === "image" && isPublicUrl) {
      attachment = { type: "image", payload: { url: params.mediaUrl.trim() } };
    } else {
      const fileName = loaded.fileName || fileNameFromUrl(params.mediaUrl, `max-${type}`);
      attachment = await uploadAndBuildAttachment({
        apiRoot: account.apiRoot,
        token: account.token,
        type,
        buffer: loaded.buffer,
        fileName,
        ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
      });
    }
  }

  return await sendMaxText({
    cfg: params.cfg,
    to: params.to,
    accountId: params.accountId ?? null,
    text: params.text ?? "",
    replyToId: params.replyToId ?? null,
    ...(params.buttons ? { buttons: params.buttons } : {}),
    mediaAttachments: [attachment],
  });
}

export type SendMaxCallbackAnswerParams = {
  cfg: CoreConfig;
  callbackId: string;
  accountId?: string | null;
  /** Optional notification text shown to the pressing user. */
  notification?: string;
};

/**
 * Acknowledge a callback button press. Mirrors the
 * `POST /answers?callback_id=<id>` endpoint that the SDK exposes via
 * `Api.answerOnCallback`. Without this answer the MAX client keeps the
 * loading spinner spinning on the user's button.
 */
export async function sendMaxCallbackAnswer(params: SendMaxCallbackAnswerParams): Promise<void> {
  const account = resolveMaxAccount({
    cfg: params.cfg,
    accountId: params.accountId ?? null,
  });
  if (!account.token) {
    return;
  }
  try {
    await pollingHttpRequest({
      apiRoot: account.apiRoot,
      path: "/answers",
      method: "POST",
      token: account.token,
      query: { callback_id: params.callbackId },
      body: params.notification ? { notification: params.notification } : {},
      requestTimeoutMs: SEND_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw new Error(
        `MAX Messenger: token for account "${account.accountId}" was rejected by the API (HTTP 401).`,
        { cause: err },
      );
    }
    throw err;
  }
}
