/**
 * Phase 3 unit tests for the pure helpers around `message_callback` events
 * and outbound inline keyboards. The pure path stays in `normalize.ts` and
 * `send.ts`; the heavier `handleMaxCallback` / `handleMaxInbound` flows
 * (which pull the agent reply pipeline) are exercised end-to-end via the
 * gateway lifecycle in real openclaw runs and the Phase 6 test sweep.
 */
import { describe, expect, it } from "vitest";
import { normalizeMaxCallbackEvent } from "../src/normalize.js";
import { buildInlineKeyboardAttachment, type MaxOutboundButton } from "../src/send.js";

describe("normalizeMaxCallbackEvent", () => {
  it("normalizes a callback in a DM with payload + sender", () => {
    const result = normalizeMaxCallbackEvent({
      update_type: "message_callback",
      timestamp: 1714747300000,
      callback: {
        callback_id: "cb-abc",
        payload: "approve:1234",
        timestamp: 1714747300000,
        user: { user_id: 1001, first_name: "Alice", last_name: "P" },
      },
      message: {
        recipient: { chat_id: 200, chat_type: "dialog" },
        body: { mid: "msg-with-buttons" },
      },
    });
    expect(result).toEqual({
      callbackId: "cb-abc",
      payload: "approve:1234",
      senderId: "1001",
      senderName: "Alice P",
      chatId: "200",
      isGroupChat: false,
      parentMessageId: "msg-with-buttons",
      timestamp: 1714747300000,
    });
  });

  it("flags isGroupChat when recipient.chat_type !== 'dialog'", () => {
    const result = normalizeMaxCallbackEvent({
      update_type: "message_callback",
      timestamp: 1,
      callback: {
        callback_id: "cb-grp",
        payload: "p",
        user: { user_id: 1, first_name: "A" },
      },
      message: {
        recipient: { chat_id: 999, chat_type: "chat" },
        body: { mid: "m" },
      },
    });
    expect(result?.isGroupChat).toBe(true);
  });

  it("falls back to user:<id> when no first/last name", () => {
    const result = normalizeMaxCallbackEvent({
      update_type: "message_callback",
      timestamp: 1,
      callback: {
        callback_id: "cb",
        user: { user_id: 42 },
      },
      message: {
        recipient: { chat_id: 1, chat_type: "dialog" },
      },
    });
    expect(result?.senderName).toBe("user:42");
  });

  it("returns null when callback_id / chat_id / user_id missing", () => {
    expect(
      normalizeMaxCallbackEvent({
        update_type: "message_callback",
        timestamp: 1,
        callback: { user: { user_id: 1, first_name: "A" } },
        message: { recipient: { chat_id: 1, chat_type: "dialog" } },
      }),
    ).toBeNull();
    expect(
      normalizeMaxCallbackEvent({
        update_type: "message_callback",
        timestamp: 1,
        callback: { callback_id: "cb", user: { user_id: 1 } },
        message: { recipient: { chat_type: "dialog" } },
      }),
    ).toBeNull();
    expect(
      normalizeMaxCallbackEvent({
        update_type: "message_callback",
        timestamp: 1,
        callback: { callback_id: "cb", user: {} },
        message: { recipient: { chat_id: 1, chat_type: "dialog" } },
      }),
    ).toBeNull();
  });

  it("returns null for non-callback updates", () => {
    expect(
      normalizeMaxCallbackEvent({
        update_type: "message_created",
        timestamp: 1,
        callback: null,
        message: null,
      }),
    ).toBeNull();
  });

  it("preserves undefined payload (callback button without payload)", () => {
    const result = normalizeMaxCallbackEvent({
      update_type: "message_callback",
      timestamp: 1,
      callback: {
        callback_id: "cb",
        user: { user_id: 1, first_name: "A" },
      },
      message: { recipient: { chat_id: 1, chat_type: "dialog" } },
    });
    expect(result?.payload).toBeUndefined();
  });
});

describe("buildInlineKeyboardAttachment", () => {
  it("returns undefined for empty / missing button matrices", () => {
    expect(buildInlineKeyboardAttachment(undefined)).toBeUndefined();
    expect(buildInlineKeyboardAttachment([])).toBeUndefined();
    expect(buildInlineKeyboardAttachment([[], []])).toBeUndefined();
  });

  it("serializes a single-row callback button matrix", () => {
    const buttons: MaxOutboundButton[][] = [[{ type: "callback", text: "Approve", payload: "ok" }]];
    const attachment = buildInlineKeyboardAttachment(buttons);
    expect(attachment).toEqual({
      type: "inline_keyboard",
      payload: {
        buttons: [[{ type: "callback", text: "Approve", payload: "ok" }]],
      },
    });
  });

  it("preserves multi-row layouts (rows = arrays)", () => {
    const buttons: MaxOutboundButton[][] = [
      [
        { type: "callback", text: "Yes", payload: "y", intent: "positive" },
        { type: "callback", text: "No", payload: "n", intent: "negative" },
      ],
      [{ type: "link", text: "Docs", url: "https://example.com" }],
    ];
    const attachment = buildInlineKeyboardAttachment(buttons);
    expect(attachment?.payload.buttons).toHaveLength(2);
    expect(attachment?.payload.buttons[0]).toHaveLength(2);
    expect(attachment?.payload.buttons[1]?.[0]).toMatchObject({
      type: "link",
      url: "https://example.com",
    });
  });

  it("supports request_contact / request_geo_location / chat button types", () => {
    const buttons: MaxOutboundButton[][] = [
      [{ type: "request_contact", text: "Share contact" }],
      [{ type: "request_geo_location", text: "Share location", quick: true }],
      [{ type: "chat", text: "Open chat", chat_title: "Support" }],
    ];
    const attachment = buildInlineKeyboardAttachment(buttons);
    expect(attachment?.payload.buttons.flat().map((b) => b.type)).toEqual([
      "request_contact",
      "request_geo_location",
      "chat",
    ]);
  });

  it("drops empty rows but keeps non-empty siblings", () => {
    const buttons: MaxOutboundButton[][] = [
      [],
      [{ type: "callback", text: "Only", payload: "x" }],
      [],
    ];
    const attachment = buildInlineKeyboardAttachment(buttons);
    expect(attachment?.payload.buttons).toHaveLength(1);
    expect(attachment?.payload.buttons[0]?.[0]).toMatchObject({ type: "callback", text: "Only" });
  });
});
