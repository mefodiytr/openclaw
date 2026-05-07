/**
 * Phase 6 wire-format tests for `sendMaxText`. Mocks `globalThis.fetch` so
 * we can lock the exact `POST /messages?chat_id=<n>` body MAX sees:
 *   - text body
 *   - link.reply for reply-to threading
 *   - attachments[] ordering (media first, inline_keyboard last)
 *   - account / token / chat_id resolution from cfg
 *   - 401 → wrapped UnauthorizedError surface
 *
 * Outbound multipart upload is covered separately in `attachments.test.ts`;
 * here we focus on the JSON `POST /messages` shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInlineKeyboardAttachment,
  parseChatId,
  sendMaxText,
  type MaxOutboundButton,
} from "../src/send.js";
import type { CoreConfig } from "../src/types.js";

type FetchCall = {
  url: string;
  method?: string;
  body?: unknown;
  authHeader?: string | null;
};

let originalFetch: typeof globalThis.fetch | undefined;
let calls: FetchCall[] = [];

function installFetch(handler: (call: FetchCall) => Response | Promise<Response>): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    let parsedBody: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    const headers = new Headers(init?.headers ?? {});
    const call: FetchCall = {
      url,
      method,
      body: parsedBody,
      authHeader: headers.get("Authorization"),
    };
    calls.push(call);
    return await handler(call);
  }) as typeof globalThis.fetch;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
});

const baseCfg: CoreConfig = {
  channels: {
    "max-messenger": { token: "tk-default" },
  },
};

describe("parseChatId", () => {
  it("parses bare integer / max: prefix / negative ids", () => {
    expect(parseChatId("12345")).toBe(12345);
    expect(parseChatId("max:12345")).toBe(12345);
    expect(parseChatId("-987654")).toBe(-987654);
  });
});

describe("sendMaxText", () => {
  it("issues POST /messages with the parsed chat_id and bearer token", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-1" } } }));
    const result = await sendMaxText({
      cfg: baseCfg,
      to: "max:42",
      text: "hello",
    });
    expect(result.messageId).toBe("mid-1");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toContain("/messages");
    expect(call.url).toContain("chat_id=42");
    expect(call.method).toBe("POST");
    expect(call.authHeader).toBe("tk-default");
    expect(call.body).toEqual({ text: "hello" });
  });

  it("includes link.reply when replyToId is provided", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-2" } } }));
    await sendMaxText({
      cfg: baseCfg,
      to: "42",
      text: "follow-up",
      replyToId: "parent-mid",
    });
    expect((calls[0].body as { link?: unknown }).link).toEqual({
      type: "reply",
      mid: "parent-mid",
    });
  });

  it("omits link.reply when replyToId is empty / whitespace / null", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-3" } } }));
    await sendMaxText({ cfg: baseCfg, to: "42", text: "x", replyToId: "  " });
    await sendMaxText({ cfg: baseCfg, to: "42", text: "x", replyToId: null });
    for (const call of calls) {
      expect(call.body).not.toHaveProperty("link");
    }
  });

  it("serializes inline keyboard buttons into attachments[type=inline_keyboard]", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-4" } } }));
    const buttons: MaxOutboundButton[][] = [
      [{ type: "callback", text: "Yes", payload: "y", intent: "positive" }],
    ];
    await sendMaxText({ cfg: baseCfg, to: "42", text: "approve?", buttons });
    expect((calls[0].body as { attachments: unknown[] }).attachments).toEqual([
      buildInlineKeyboardAttachment(buttons),
    ]);
  });

  it("orders mediaAttachments before the inline keyboard (media first, keyboard last)", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-5" } } }));
    await sendMaxText({
      cfg: baseCfg,
      to: "42",
      text: "see this and decide",
      mediaAttachments: [{ type: "image", payload: { url: "https://cdn/p.jpg" } }],
      buttons: [[{ type: "callback", text: "OK", payload: "ok" }]],
    });
    const atts = (calls[0].body as { attachments: Array<{ type: string }> }).attachments;
    expect(atts).toHaveLength(2);
    expect(atts[0]?.type).toBe("image");
    expect(atts[1]?.type).toBe("inline_keyboard");
  });

  it("synthesizes a placeholder messageId when MAX response omits mid", async () => {
    installFetch(() => jsonResponse({ message: { body: {} } }));
    const result = await sendMaxText({ cfg: baseCfg, to: "42", text: "x" });
    expect(result.messageId).toMatch(/^max-send-\d+$/u);
  });

  it("resolves a per-account token from accounts.<id>", async () => {
    installFetch(() => jsonResponse({ message: { body: { mid: "mid-6" } } }));
    await sendMaxText({
      cfg: {
        channels: {
          "max-messenger": {
            accounts: { support: { token: "tk-s" } },
          },
        },
      },
      to: "42",
      accountId: "support",
      text: "x",
    });
    expect(calls[0].authHeader).toBe("tk-s");
  });

  it("throws a friendly error when no token is configured", async () => {
    installFetch(() => jsonResponse({}));
    const prev = process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_BOT_TOKEN;
    try {
      await expect(
        sendMaxText({ cfg: { channels: { "max-messenger": {} } }, to: "42", text: "x" }),
      ).rejects.toThrow(/no token available/iu);
    } finally {
      if (prev !== undefined) {
        process.env.MAX_BOT_TOKEN = prev;
      }
    }
    // No HTTP call should have been issued — the guard fires before fetch.
    expect(calls).toHaveLength(0);
  });

  it("wraps a 401 response into a friendly token-rejected error", async () => {
    installFetch(() => new Response("nope", { status: 401, statusText: "Unauthorized" }));
    await expect(sendMaxText({ cfg: baseCfg, to: "42", text: "x" })).rejects.toThrow(
      /token for account "default" was rejected by the API \(HTTP 401\)/iu,
    );
  });
});
