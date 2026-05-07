import { clearAccountEntryFields } from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { replaceConfigFile } from "openclaw/plugin-sdk/config-mutation";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { resolveMaxAccount } from "../account-resolver.js";
import { createMarkerStore } from "../polling/marker-store.js";
import type { CoreConfig, ResolvedMaxAccount } from "../types.js";
import { maxMessengerLifecycleAdapter } from "./lifecycle.adapter.js";

/**
 * Pure helper that builds the post-logout `openclaw.json` for the given
 * account id. Returns `{ nextCfg, changed, cleared }`:
 *   - `changed: false` → caller can skip the disk write entirely.
 *   - `cleared: true`  → at least one credential field was removed.
 *
 * Splitting this out of the gateway lets the unit test exercise the cfg
 * mutation without mocking `replaceConfigFile` (which is a real fs writer).
 */
export function buildPostLogoutMaxConfig(
  cfg: OpenClawConfig,
  accountId: string,
): { nextCfg: OpenClawConfig; changed: boolean; cleared: boolean } {
  const nextCfg = { ...cfg } as OpenClawConfig;
  const baseSection = (cfg.channels as Record<string, Record<string, unknown> | undefined>)?.[
    "max-messenger"
  ];
  const nextSection = baseSection ? ({ ...baseSection } as Record<string, unknown>) : undefined;
  let cleared = false;
  let changed = false;

  if (nextSection) {
    if (accountId === DEFAULT_ACCOUNT_ID) {
      for (const field of ["token", "tokenFile"] as const) {
        if (field in nextSection) {
          delete nextSection[field];
          cleared = true;
          changed = true;
        }
      }
    }
    const accountCleanup = clearAccountEntryFields({
      accounts: nextSection.accounts as Record<string, object> | undefined,
      accountId,
      fields: ["token", "tokenFile"],
    });
    if (accountCleanup.changed) {
      changed = true;
      if (accountCleanup.cleared) {
        cleared = true;
      }
      if (accountCleanup.nextAccounts) {
        nextSection.accounts = accountCleanup.nextAccounts as Record<string, unknown>;
      } else {
        delete nextSection.accounts;
      }
    }
  }

  if (!changed) {
    return { nextCfg, changed, cleared };
  }
  if (nextSection && Object.keys(nextSection).length > 0) {
    nextCfg.channels = {
      ...nextCfg.channels,
      "max-messenger": nextSection,
    } as OpenClawConfig["channels"];
  } else {
    const nextChannels = { ...nextCfg.channels } as Record<string, unknown>;
    delete nextChannels["max-messenger"];
    if (Object.keys(nextChannels).length > 0) {
      nextCfg.channels = nextChannels as OpenClawConfig["channels"];
    } else {
      delete nextCfg.channels;
    }
  }
  return { nextCfg, changed, cleared };
}

/**
 * Gateway adapter for the MAX channel.
 *
 * `startAccount` / `stopAccount` proxy to the lifecycle adapter (per-account
 * polling supervisor, per-account dedup cache, per-account marker store —
 * the multi-account skeleton has been in place since Phase 1B).
 *
 * Phase 5 adds `logoutAccount` so `openclaw channels logout max-messenger`
 * (and the equivalent `channels remove` flow) clears the persisted token /
 * tokenFile from `openclaw.json` AND drops the marker file so a fresh start
 * cannot accidentally replay events from a token that no longer owns the bot.
 */
export const maxMessengerGatewayAdapter: NonNullable<ChannelPlugin<ResolvedMaxAccount>["gateway"]> =
  {
    startAccount: async (ctx) => {
      await maxMessengerLifecycleAdapter.start(ctx);
    },
    stopAccount: async (ctx) => {
      await maxMessengerLifecycleAdapter.stop(ctx);
    },
    logoutAccount: async ({ accountId, cfg }) => {
      const { nextCfg, changed, cleared } = buildPostLogoutMaxConfig(cfg, accountId);

      if (changed) {
        await replaceConfigFile({
          nextConfig: nextCfg,
          afterWrite: { mode: "auto" },
        });
      }

      // Drop the persisted marker so a future start with a fresh token does
      // not replay events the rotated bot saw. Mirrors Telegram's
      // update-offset-store reset on bot-id mismatch.
      try {
        await createMarkerStore({ accountId }).clear();
      } catch {
        // Best-effort: marker file might not exist (clean install) or sit on
        // a read-only mount; the operator already wrote-out the cleared cfg.
      }

      const resolved = resolveMaxAccount({
        cfg: changed ? (nextCfg as CoreConfig) : (cfg as CoreConfig),
        accountId,
      });
      const loggedOut = resolved.tokenSource === "none";

      return {
        cleared,
        envSecret: Boolean(process.env.MAX_BOT_TOKEN?.trim()),
        loggedOut,
      };
    },
  };
