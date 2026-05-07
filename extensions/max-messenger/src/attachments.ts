/**
 * Outbound attachment helpers for the MAX channel (Phase 4).
 *
 * MAX's wire format for outbound attachments is `attachments[]` with a
 * discriminated `type` field. For images, MAX accepts a URL shortcut where
 * the API itself fetches the URL and re-hosts the bytes — we lean on this
 * because the agent reply pipeline already produces public `mediaUrl`s and
 * round-tripping bytes through the bot would slow large media replies.
 *
 * For non-image media (audio, video, generic file) MAX requires a two-step
 * upload: `POST /uploads?type=<t>` returns a presigned URL, the client
 * pushes the bytes there, and MAX returns a `token` to reference in
 * `attachments[]`. Phase 4 ships the URL shortcut for images and the
 * two-step buffer-upload helper for other types; richer source kinds
 * (Node `fs.ReadStream`, multipart-with-Content-Range) are deferred to
 * Phase 4+ when concrete callers need them.
 */

import { pollingHttpRequest } from "./polling/polling-http.js";

const UPLOAD_REQUEST_TIMEOUT_MS = 60_000;

export type MaxAttachmentType = "image" | "video" | "audio" | "file";

export type MaxImageAttachmentRequest = {
  type: "image";
  payload: { url?: string; token?: string; photos?: Record<string, { token: string }> };
};

export type MaxMediaAttachmentRequest = {
  type: "video" | "audio" | "file";
  payload: { token: string };
};

export type MaxOutboundAttachment = MaxImageAttachmentRequest | MaxMediaAttachmentRequest;

/**
 * Build an `image` attachment using the URL shortcut. MAX fetches the URL
 * server-side and embeds the result, so the bot avoids streaming bytes
 * through itself.
 */
export function buildImageAttachmentFromUrl(url: string): MaxImageAttachmentRequest {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("MAX Messenger: image URL is empty.");
  }
  return { type: "image", payload: { url: url.trim() } };
}

/**
 * Wrap an upload `token` (returned by the two-step flow) into the proper
 * outbound shape for the given media type.
 */
export function buildAttachmentFromToken(
  type: MaxAttachmentType,
  token: string,
): MaxOutboundAttachment {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("MAX Messenger: attachment token is empty.");
  }
  if (type === "image") {
    return { type: "image", payload: { token: token.trim() } };
  }
  return { type, payload: { token: token.trim() } };
}

type GetUploadUrlResponse = {
  url: string;
  token?: string;
};

/**
 * `POST /uploads?type=<t>` to obtain a presigned upload URL. Used by the
 * two-step buffer-upload helper below; exported so external callers can
 * orchestrate large multipart streams themselves when they need to avoid
 * loading the whole file into memory.
 */
export async function requestMaxUploadUrl(params: {
  apiRoot: string;
  token: string;
  type: MaxAttachmentType;
  signal?: AbortSignal;
}): Promise<GetUploadUrlResponse> {
  return await pollingHttpRequest<GetUploadUrlResponse>({
    apiRoot: params.apiRoot,
    path: "/uploads",
    method: "POST",
    token: params.token,
    query: { type: params.type },
    requestTimeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
    ...(params.signal ? { signal: params.signal } : {}),
  });
}

type UploadFromBufferResponse = {
  /** Image multipart response: `{ photos: { [id]: { token } } }`. */
  photos?: Record<string, { token: string }>;
  /** Single-token response (audio / video / file multipart). */
  token?: string;
};

/**
 * Upload a `Buffer` to a presigned MAX upload URL via multipart form data.
 * For images, MAX returns `{ photos: { [id]: { token } } }`; for
 * audio/video/file the original `requestMaxUploadUrl` response already
 * contains the token. Both shapes are normalized into a flat `{ token }`.
 */
export async function uploadMaxBuffer(params: {
  uploadUrl: string;
  buffer: Buffer | Uint8Array;
  fileName: string;
  fallbackToken?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ token: string; photos?: Record<string, { token: string }> }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const formData = new FormData();
  // Convert Buffer/Uint8Array → BlobPart-safe Uint8Array<ArrayBuffer>. A bare
  // `new Blob([params.buffer])` widens to `ArrayBufferLike`, which TS rejects
  // because `SharedArrayBuffer` lives in that union too.
  const view = new Uint8Array(params.buffer.byteLength);
  view.set(params.buffer);
  formData.append("data", new Blob([view]), params.fileName);
  const response = await fetchImpl(params.uploadUrl, {
    method: "POST",
    body: formData,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new Error(`MAX upload failed (${response.status}): ${text || response.statusText}`);
  }
  const parsed = (await response.json().catch(() => ({}))) as UploadFromBufferResponse;
  if (parsed.photos) {
    const firstEntry = Object.values(parsed.photos)[0];
    if (firstEntry?.token) {
      return { token: firstEntry.token, photos: parsed.photos };
    }
  }
  if (parsed.token) {
    return { token: parsed.token };
  }
  if (params.fallbackToken) {
    return { token: params.fallbackToken };
  }
  throw new Error(
    `MAX upload response missing 'photos' / 'token' fields: ${JSON.stringify(parsed)}`,
  );
}

/**
 * High-level helper: do the two-step upload of a buffer and return the
 * built `MaxOutboundAttachment`. For images the URL shortcut is preferred —
 * see `buildImageAttachmentFromUrl`.
 */
export async function uploadAndBuildAttachment(params: {
  apiRoot: string;
  token: string;
  type: MaxAttachmentType;
  buffer: Buffer | Uint8Array;
  fileName: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<MaxOutboundAttachment> {
  const uploadInfo = await requestMaxUploadUrl({
    apiRoot: params.apiRoot,
    token: params.token,
    type: params.type,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const uploaded = await uploadMaxBuffer({
    uploadUrl: uploadInfo.url,
    buffer: params.buffer,
    fileName: params.fileName,
    ...(uploadInfo.token ? { fallbackToken: uploadInfo.token } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });
  if (params.type === "image") {
    return uploaded.photos
      ? { type: "image", payload: { photos: uploaded.photos } }
      : { type: "image", payload: { token: uploaded.token } };
  }
  return { type: params.type, payload: { token: uploaded.token } };
}
