/**
 * Outbound adapter for the MAX channel.
 *
 * Phase 1B.1 wired `sendText` through `polling-http` so the agent reply
 * pipeline reaches MAX with the same Retry-After / 401 / per-request-timeout
 * semantics as polling. Phase 4 wires `sendMedia` against the same wrapper:
 * images with a public URL use MAX's URL shortcut, everything else flows
 * through the two-step upload helpers in `attachments.ts`.
 *
 * `sendPoll` still throws — polls are not on the plan today.
 */

import { MAX_TEXT_CHUNK_LIMIT } from "../constants.js";
import { sendMaxMedia, sendMaxText } from "../send.js";
import type { CoreConfig } from "../types.js";

export const maxMessengerOutboundAdapter = {
  base: {
    deliveryMode: "direct" as const,
    chunkerMode: "text" as const,
    textChunkLimit: MAX_TEXT_CHUNK_LIMIT,
    extractMarkdownImages: true,
  },
  attachedResults: {
    channel: "max-messenger",
    sendText: async ({
      cfg,
      to,
      accountId,
      text,
      replyToId,
    }: {
      cfg: unknown;
      to: string;
      accountId?: string | null;
      text: string;
      replyToId?: string | null;
    }) => {
      return sendMaxText({
        cfg: cfg as CoreConfig,
        to,
        accountId: accountId ?? null,
        text,
        replyToId: replyToId ?? null,
      });
    },
    sendMedia: async ({
      cfg,
      to,
      accountId,
      text,
      mediaUrl,
      mediaAccess,
      mediaLocalRoots,
      mediaReadFile,
      replyToId,
    }: {
      cfg: unknown;
      to: string;
      accountId?: string | null;
      text: string;
      mediaUrl?: string;
      mediaAccess?: Parameters<typeof sendMaxMedia>[0]["mediaAccess"];
      mediaLocalRoots?: readonly string[];
      mediaReadFile?: (filePath: string) => Promise<Buffer>;
      replyToId?: string | null;
    }) => {
      if (!mediaUrl) {
        return sendMaxText({
          cfg: cfg as CoreConfig,
          to,
          accountId: accountId ?? null,
          text,
          replyToId: replyToId ?? null,
        });
      }
      return sendMaxMedia({
        cfg: cfg as CoreConfig,
        to,
        accountId: accountId ?? null,
        text,
        mediaUrl,
        replyToId: replyToId ?? null,
        ...(mediaAccess ? { mediaAccess } : {}),
        ...(mediaLocalRoots ? { mediaLocalRoots } : {}),
        ...(mediaReadFile ? { mediaReadFile } : {}),
      });
    },
    sendPoll: async () => {
      throw new Error("max-messenger sendPoll: not implemented");
    },
  },
};
