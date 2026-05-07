/**
 * Phase 4 unit tests for outbound attachment helpers in `attachments.ts`
 * and the higher-level `sendMaxMedia` flow in `send.ts`. The full
 * `handleMaxInbound` + agent reply pipeline integration is exercised at
 * the gateway level in real openclaw runs and the Phase 6 test sweep.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildAttachmentFromToken,
  buildImageAttachmentFromUrl,
  uploadMaxBuffer,
} from "../src/attachments.js";

describe("buildImageAttachmentFromUrl", () => {
  it("builds an image attachment with the URL shortcut", () => {
    expect(buildImageAttachmentFromUrl("https://cdn.example.com/p.jpg")).toEqual({
      type: "image",
      payload: { url: "https://cdn.example.com/p.jpg" },
    });
  });

  it("trims surrounding whitespace", () => {
    expect(buildImageAttachmentFromUrl("  https://x  ")).toEqual({
      type: "image",
      payload: { url: "https://x" },
    });
  });

  it("throws on empty / non-string input", () => {
    expect(() => buildImageAttachmentFromUrl("")).toThrow(/image URL is empty/iu);
    expect(() => buildImageAttachmentFromUrl("   ")).toThrow(/image URL is empty/iu);
    // @ts-expect-error -- runtime guard
    expect(() => buildImageAttachmentFromUrl(undefined)).toThrow(/image URL is empty/iu);
  });
});

describe("buildAttachmentFromToken", () => {
  it("wraps an image token", () => {
    expect(buildAttachmentFromToken("image", "tk-1")).toEqual({
      type: "image",
      payload: { token: "tk-1" },
    });
  });

  it("wraps audio / video / file tokens", () => {
    expect(buildAttachmentFromToken("audio", "tk-a")).toEqual({
      type: "audio",
      payload: { token: "tk-a" },
    });
    expect(buildAttachmentFromToken("video", "tk-v")).toEqual({
      type: "video",
      payload: { token: "tk-v" },
    });
    expect(buildAttachmentFromToken("file", "tk-f")).toEqual({
      type: "file",
      payload: { token: "tk-f" },
    });
  });

  it("throws on empty token", () => {
    expect(() => buildAttachmentFromToken("file", "")).toThrow(/attachment token is empty/iu);
    expect(() => buildAttachmentFromToken("file", "   ")).toThrow(/attachment token is empty/iu);
  });
});

describe("uploadMaxBuffer", () => {
  it("posts multipart/form-data and returns photo token from photos[]", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push({ url: urlString, init: init ?? {} });
      return new Response(JSON.stringify({ photos: { p1: { token: "tok-photo" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await uploadMaxBuffer({
      uploadUrl: "https://upload.max.ru/x",
      buffer: Buffer.from("PNGDATA"),
      fileName: "p.png",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe("tok-photo");
    expect(result.photos).toEqual({ p1: { token: "tok-photo" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://upload.max.ru/x");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
  });

  it("returns flat token when MAX responds with { token } (audio / video / file)", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ token: "tok-flat" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await uploadMaxBuffer({
      uploadUrl: "https://upload.max.ru/x",
      buffer: Buffer.from("OGGDATA"),
      fileName: "a.ogg",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe("tok-flat");
    expect(result.photos).toBeUndefined();
  });

  it("falls back to `fallbackToken` (from /uploads response) when body has neither field", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await uploadMaxBuffer({
      uploadUrl: "https://upload.max.ru/x",
      buffer: Buffer.from("X"),
      fileName: "f.bin",
      fallbackToken: "tok-prereg",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe("tok-prereg");
  });

  it("throws on >=400 with body text in the error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("nope", {
          status: 413,
          statusText: "Payload Too Large",
        }),
    );
    await expect(
      uploadMaxBuffer({
        uploadUrl: "https://upload.max.ru/x",
        buffer: Buffer.from("X"),
        fileName: "f.bin",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/MAX upload failed \(413\)/iu);
  });

  it("throws when upload response has no photos / token / fallbackToken", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      uploadMaxBuffer({
        uploadUrl: "https://upload.max.ru/x",
        buffer: Buffer.from("X"),
        fileName: "f.bin",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/missing 'photos' \/ 'token'/iu);
  });
});
