/**
 * Unit tests for the pure helpers around the inbound dispatcher: the raw-update
 * → `MaxInboundMessage` normalizer (`inbound.ts`), the chat-id parser used by
 * outbound (`send.ts`), and the target-prefix stripper used by the messaging
 * adapter (`normalize.ts`). These are pure modules — no live SDK runtime, no
 * fake-MAX server.
 *
 * The end-to-end `handleMaxInbound` integration (real pairing controller +
 * `dispatchInboundReplyWithBase` + agent reply pipeline) needs the injected
 * `PluginRuntime` from the channel-entry-contract loader and is exercised
 * via the gateway lifecycle in real openclaw runs; covering it from a pure
 * vitest run requires reproducing the runtime bootstrap, which we defer to
 * Phase 6 (test sweep).
 */
import { describe, expect, it } from "vitest";
import {
  looksLikeMaxTargetId,
  normalizeMaxInboundAttachments,
  normalizeMaxInboundMessage,
  normalizeMaxMessagingTarget,
} from "../src/normalize.js";
// Import parseChatId via the lightweight outbound chat-id parser. `send.ts`
// transitively imports `polling-http.ts`, but `parseChatId` itself is pure
// and the SDK boundary stays out of the call graph for this test.
import { parseChatId } from "../src/send.js";

describe("normalizeMaxInboundMessage", () => {
  it("normalizes a DM message with sender, recipient, body", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1714747200000,
      message: {
        sender: { user_id: 1001, first_name: "Alice", last_name: "Petrova" },
        recipient: { chat_id: 200, chat_type: "dialog" },
        timestamp: 1714747200000,
        body: { mid: "msg-1", text: "hello" },
      },
    });
    expect(result).toEqual({
      messageId: "msg-1",
      chatId: "200",
      chatTitle: undefined,
      senderId: "1001",
      senderName: "Alice Petrova",
      text: "hello",
      timestamp: 1714747200000,
      isGroupChat: false,
      replyToMessageId: undefined,
    });
  });

  it("flags groups when recipient.chat_type !== 'dialog'", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1001, first_name: "Alice" },
        recipient: { chat_id: 999, chat_type: "chat" },
        timestamp: 1,
        body: { mid: "msg-grp", text: "hi" },
      },
    });
    expect(result?.isGroupChat).toBe(true);
  });

  it("falls back to user:<id> when no first/last name is present", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 42 },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: { mid: "msg-x", text: "yo" },
      },
    });
    expect(result?.senderName).toBe("user:42");
  });

  it("captures replyToMessageId when message.link.type === 'reply'", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1, first_name: "A" },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: { mid: "msg-y", text: "follow-up" },
        link: { type: "reply", message: { mid: "parent-mid" } },
      },
    });
    expect(result?.replyToMessageId).toBe("parent-mid");
  });

  it("ignores forward links (type !== 'reply')", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1, first_name: "A" },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: { mid: "msg-z", text: "fw" },
        link: { type: "forward", message: { mid: "ignored" } },
      },
    });
    expect(result?.replyToMessageId).toBeUndefined();
  });

  it("returns null for non-message updates", () => {
    expect(
      normalizeMaxInboundMessage({
        update_type: "bot_started",
        timestamp: 1,
        message: null,
      }),
    ).toBeNull();
  });

  it("returns null when mid / chat_id / sender.user_id are missing", () => {
    expect(
      normalizeMaxInboundMessage({
        update_type: "message_created",
        timestamp: 1,
        message: {
          sender: { user_id: 1, first_name: "A" },
          recipient: { chat_id: 1, chat_type: "dialog" },
          timestamp: 1,
          body: { mid: null, text: "x" },
        },
      }),
    ).toBeNull();
    expect(
      normalizeMaxInboundMessage({
        update_type: "message_created",
        timestamp: 1,
        message: {
          sender: { user_id: 1, first_name: "A" },
          recipient: { chat_type: "dialog" },
          timestamp: 1,
          body: { mid: "x", text: "x" },
        },
      }),
    ).toBeNull();
    expect(
      normalizeMaxInboundMessage({
        update_type: "message_created",
        timestamp: 1,
        message: {
          sender: { first_name: "A" },
          recipient: { chat_id: 1, chat_type: "dialog" },
          timestamp: 1,
          body: { mid: "x", text: "x" },
        },
      }),
    ).toBeNull();
  });

  it("treats empty body text as empty string (caller drops empties)", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1, first_name: "A" },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: { mid: "msg-empty", text: null },
      },
    });
    expect(result?.text).toBe("");
  });

  it("lifts media attachments through to MaxInboundMessage.attachments", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1, first_name: "A" },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: {
          mid: "msg-media",
          text: "see this",
          attachments: [
            {
              type: "image",
              payload: { url: "https://cdn.max.ru/p/abc.jpg", token: "tk-abc" },
            },
          ],
        },
      },
    });
    expect(result?.attachments).toEqual([
      {
        type: "image",
        url: "https://cdn.max.ru/p/abc.jpg",
        token: "tk-abc",
      },
    ]);
  });

  it("omits attachments[] when none of the inbound payloads carry a URL", () => {
    const result = normalizeMaxInboundMessage({
      update_type: "message_created",
      timestamp: 1,
      message: {
        sender: { user_id: 1, first_name: "A" },
        recipient: { chat_id: 1, chat_type: "dialog" },
        timestamp: 1,
        body: { mid: "msg-x", text: "hi" },
      },
    });
    expect(result?.attachments).toBeUndefined();
  });
});

describe("normalizeMaxInboundAttachments", () => {
  it("returns [] for missing / empty arrays", () => {
    expect(normalizeMaxInboundAttachments(undefined)).toEqual([]);
    expect(normalizeMaxInboundAttachments(null)).toEqual([]);
    expect(normalizeMaxInboundAttachments([])).toEqual([]);
  });

  it("captures image / video / audio / file media URLs", () => {
    const result = normalizeMaxInboundAttachments([
      { type: "image", payload: { url: "https://cdn/p.jpg" } },
      { type: "video", payload: { url: "https://cdn/v.mp4" }, duration: 12 },
      { type: "audio", payload: { url: "https://cdn/a.ogg" } },
      {
        type: "file",
        payload: { url: "https://cdn/f.pdf", token: "tk-f" },
        filename: "report.pdf",
        size: 4242,
      },
    ]);
    expect(result).toEqual([
      { type: "image", url: "https://cdn/p.jpg" },
      { type: "video", url: "https://cdn/v.mp4", duration: 12 },
      { type: "audio", url: "https://cdn/a.ogg" },
      {
        type: "file",
        url: "https://cdn/f.pdf",
        token: "tk-f",
        fileName: "report.pdf",
        size: 4242,
      },
    ]);
  });

  it("drops sticker / contact / share / location / inline_keyboard payloads", () => {
    const result = normalizeMaxInboundAttachments([
      { type: "sticker", payload: { url: "ignored" } },
      { type: "contact", payload: { url: "ignored" } },
      { type: "share", payload: { url: "ignored" } },
      { type: "location", payload: { url: "ignored" } },
      { type: "inline_keyboard", payload: { url: "ignored" } },
      { type: "image", payload: { url: "https://cdn/keep.jpg" } },
    ]);
    expect(result).toEqual([{ type: "image", url: "https://cdn/keep.jpg" }]);
  });

  it("drops entries without a usable payload.url", () => {
    const result = normalizeMaxInboundAttachments([
      { type: "image", payload: { url: "" } },
      { type: "video", payload: null },
      { type: "image", payload: { url: "   " } },
      { type: "audio", payload: { url: "https://cdn/a.ogg" } },
    ]);
    expect(result).toEqual([{ type: "audio", url: "https://cdn/a.ogg" }]);
  });

  it("preserves dimension / duration / thumbnail metadata when present", () => {
    const result = normalizeMaxInboundAttachments([
      {
        type: "video",
        payload: { url: "https://cdn/v.mp4" },
        width: 1280,
        height: 720,
        duration: 30,
        thumbnail: "https://cdn/thumb.jpg",
      },
    ]);
    expect(result[0]).toMatchObject({
      width: 1280,
      height: 720,
      duration: 30,
      thumbnail: "https://cdn/thumb.jpg",
    });
  });
});

describe("parseChatId (outbound target → integer chat_id)", () => {
  it("parses bare integer", () => {
    expect(parseChatId("12345")).toBe(12345);
  });

  it("strips `max:` and `max-messenger:` prefixes", () => {
    expect(parseChatId("max:12345")).toBe(12345);
    expect(parseChatId("max-messenger:12345")).toBe(12345);
    expect(parseChatId("MAX:12345")).toBe(12345);
  });

  it("trims whitespace before parsing", () => {
    expect(parseChatId("  77  ")).toBe(77);
  });

  it("throws on non-integer input", () => {
    expect(() => parseChatId("abc")).toThrow(/not a valid chat_id/iu);
    expect(() => parseChatId("")).toThrow(/not a valid chat_id/iu);
    expect(() => parseChatId("max:")).toThrow(/not a valid chat_id/iu);
  });
});

describe("normalize.ts (target prefix stripping)", () => {
  it("strips the `max-messenger:` prefix from a target", () => {
    expect(normalizeMaxMessagingTarget("max-messenger:42")).toBe("42");
  });

  it("strips the short `max:` prefix from a target", () => {
    expect(normalizeMaxMessagingTarget("max:42")).toBe("42");
  });

  it("recognizes valid integer chat ids", () => {
    expect(looksLikeMaxTargetId("42")).toBe(true);
    expect(looksLikeMaxTargetId("max:42")).toBe(true);
    expect(looksLikeMaxTargetId("max-messenger:42")).toBe(true);
  });

  it("rejects non-integer ids", () => {
    expect(looksLikeMaxTargetId("not-a-number")).toBe(false);
    expect(looksLikeMaxTargetId("max:abc")).toBe(false);
    expect(looksLikeMaxTargetId("")).toBe(false);
  });
});
