/**
 * Setup adapter + DM-policy plumbing for the MAX channel (Phase 3).
 *
 * Mirrors `extensions/nextcloud-talk/src/setup-core.ts` shape but trimmed
 * for MAX:
 *   - one credential field (`token` / `tokenFile`) instead of two (no
 *     separate API password)
 *   - no `baseUrl` validation (MAX always lives at `https://platform-api.max.ru`,
 *     overridable via `apiRoot` for tests but not exposed in the wizard)
 *   - no per-room config to migrate
 */

import type { ChannelSetupAdapter, ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/routing";
import {
  applyAccountNameToChannelSection,
  patchScopedAccountConfig,
} from "openclaw/plugin-sdk/setup";
import {
  createSetupInputPresenceValidator,
  mergeAllowFromEntries,
  promptParsedAllowFromForAccount,
  resolveSetupAccountId,
  type ChannelSetupDmPolicy,
  type WizardPrompter,
} from "openclaw/plugin-sdk/setup-runtime";
import { formatDocsLink } from "openclaw/plugin-sdk/setup-tools";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { resolveDefaultMaxAccountId, resolveMaxAccount } from "./account-resolver.js";
import type { CoreConfig } from "./types.js";

const channel = "max-messenger" as const;

type MaxSetupInput = ChannelSetupInput & {
  token?: string;
  tokenFile?: string;
};

type MaxSection = NonNullable<CoreConfig["channels"]>["max-messenger"];

function addWildcardAllowFrom(allowFrom?: Array<string | number> | null): string[] {
  return mergeAllowFromEntries(allowFrom, ["*"]);
}

export function setMaxAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  updates: Record<string, unknown>,
): CoreConfig {
  return patchScopedAccountConfig({
    cfg,
    channelKey: channel,
    accountId,
    patch: updates,
  }) as CoreConfig;
}

export function clearMaxAccountFields(
  cfg: CoreConfig,
  accountId: string,
  fields: string[],
): CoreConfig {
  const section = cfg.channels?.["max-messenger"];
  if (!section) {
    return cfg;
  }
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const nextSection = { ...section } as Record<string, unknown>;
    for (const field of fields) {
      delete nextSection[field];
    }
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        "max-messenger": nextSection as MaxSection,
      },
    } as CoreConfig;
  }
  const currentAccount = section.accounts?.[accountId];
  if (!currentAccount) {
    return cfg;
  }
  const nextAccount = { ...currentAccount } as Record<string, unknown>;
  for (const field of fields) {
    delete nextAccount[field];
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "max-messenger": {
        ...section,
        accounts: {
          ...section.accounts,
          [accountId]: nextAccount as NonNullable<typeof section.accounts>[string],
        },
      },
    },
  } as CoreConfig;
}

async function promptMaxAllowFrom(params: {
  cfg: CoreConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<CoreConfig> {
  return await promptParsedAllowFromForAccount({
    cfg: params.cfg,
    accountId: params.accountId,
    defaultAccountId: params.accountId,
    prompter: params.prompter,
    noteTitle: "MAX user id",
    noteLines: [
      "1) Open dev.max.ru and copy the user id of the operator who should DM the bot",
      "2) Or look at the polling logs when someone messages — the inbound dispatcher logs the senderId",
      "3) Multiple ids: paste comma- or newline-separated",
      `Docs: ${formatDocsLink("/channels/max-messenger", "max-messenger")}`,
    ],
    message: "MAX allowFrom (user id)",
    placeholder: "12345678",
    parseEntries: (raw) => ({
      entries: raw
        .split(/[\n,;]+/g)
        .map(normalizeLowercaseStringOrEmpty)
        .filter(Boolean),
    }),
    getExistingAllowFrom: ({ cfg, accountId }) =>
      resolveMaxAccount({ cfg, accountId }).config.allowFrom ?? [],
    mergeEntries: ({ existing, parsed }) =>
      mergeAllowFromEntries(
        existing.map((value) => normalizeLowercaseStringOrEmpty(String(value))),
        parsed,
      ),
    applyAllowFrom: ({ cfg, accountId, allowFrom }) =>
      setMaxAccountConfig(cfg, accountId, {
        dmPolicy: "allowlist",
        allowFrom,
      }),
  });
}

async function promptMaxAllowFromForAccount(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId = resolveSetupAccountId({
    accountId: params.accountId,
    defaultAccountId: resolveDefaultMaxAccountId(params.cfg as CoreConfig),
  });
  return await promptMaxAllowFrom({
    cfg: params.cfg as CoreConfig,
    prompter: params.prompter,
    accountId,
  });
}

export const maxMessengerDmPolicy: ChannelSetupDmPolicy = {
  label: "MAX",
  channel,
  policyKey: "channels.max-messenger.dmPolicy",
  allowFromKey: "channels.max-messenger.allowFrom",
  resolveConfigKeys: (cfg, accountId) => {
    const resolved = accountId ?? resolveDefaultMaxAccountId(cfg as CoreConfig);
    return resolved !== DEFAULT_ACCOUNT_ID
      ? {
          policyKey: `channels.max-messenger.accounts.${resolved}.dmPolicy`,
          allowFromKey: `channels.max-messenger.accounts.${resolved}.allowFrom`,
        }
      : {
          policyKey: "channels.max-messenger.dmPolicy",
          allowFromKey: "channels.max-messenger.allowFrom",
        };
  },
  getCurrent: (cfg, accountId) =>
    resolveMaxAccount({
      cfg: cfg as CoreConfig,
      accountId: accountId ?? resolveDefaultMaxAccountId(cfg as CoreConfig),
    }).config.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy, accountId) => {
    const resolvedAccountId = accountId ?? resolveDefaultMaxAccountId(cfg as CoreConfig);
    const resolved = resolveMaxAccount({
      cfg: cfg as CoreConfig,
      accountId: resolvedAccountId,
    });
    return setMaxAccountConfig(cfg as CoreConfig, resolvedAccountId, {
      dmPolicy: policy,
      ...(policy === "open" ? { allowFrom: addWildcardAllowFrom(resolved.config.allowFrom) } : {}),
    });
  },
  promptAllowFrom: promptMaxAllowFromForAccount,
};

/**
 * Channel setup adapter — drives `applyAccountConfig` for the
 * `openclaw onboard --channel max-messenger` non-interactive path. The
 * interactive wizard sits next door in `setup-surface.ts`.
 */
export const maxMessengerSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name,
    }),
  validateInput: createSetupInputPresenceValidator({
    defaultAccountOnlyEnvError: "MAX_BOT_TOKEN can only be used for the default account.",
    validate: ({ input }) => {
      const setupInput = input as MaxSetupInput;
      if (!setupInput.useEnv && !setupInput.token && !setupInput.tokenFile) {
        return "MAX requires bot token or --token-file (or --use-env).";
      }
      return null;
    },
  }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const setupInput = input as MaxSetupInput;
    const namedConfig = applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name: setupInput.name,
    });
    const next = setupInput.useEnv
      ? clearMaxAccountFields(namedConfig as CoreConfig, accountId, ["token", "tokenFile"])
      : namedConfig;
    const patch = setupInput.useEnv
      ? {}
      : setupInput.tokenFile
        ? { tokenFile: setupInput.tokenFile }
        : setupInput.token
          ? { token: setupInput.token }
          : {};
    return setMaxAccountConfig(next as CoreConfig, accountId, patch);
  },
};
