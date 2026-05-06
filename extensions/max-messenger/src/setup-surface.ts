/**
 * Interactive `openclaw onboard` wizard for the MAX channel (Phase 3).
 *
 * Mirrors `extensions/nextcloud-talk/src/setup-surface.ts`, simplified for
 * MAX:
 *   - one credential (`token` / `tokenFile` / `MAX_BOT_TOKEN` env)
 *   - no `baseUrl` prompt (apiRoot is internal-only)
 *   - no API user / password (MAX has no equivalent)
 *
 * The wizard reads/writes through `setup-core.ts`'s helpers so the
 * non-interactive `openclaw channels add max-messenger --token=...` path
 * stays in lockstep.
 */

import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input";
import {
  createStandardChannelSetupStatus,
  formatDocsLink,
  setSetupChannelEnabled,
  type ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { resolveMaxAccount } from "./account-resolver.js";
import { MAX_BOT_TOKEN_ENV } from "./constants.js";
import { clearMaxAccountFields, maxMessengerDmPolicy, setMaxAccountConfig } from "./setup-core.js";
import type { CoreConfig } from "./types.js";

const channel = "max-messenger" as const;

export const maxMessengerSetupWizard: ChannelSetupWizard = {
  channel,
  stepOrder: "text-first",
  status: createStandardChannelSetupStatus({
    channelLabel: "MAX",
    configuredLabel: "configured",
    unconfiguredLabel: "needs setup",
    configuredHint: "configured",
    unconfiguredHint: "Russian messenger (VK)",
    configuredScore: 1,
    unconfiguredScore: 5,
    resolveConfigured: ({ cfg, accountId }) => {
      const account = resolveMaxAccount({ cfg: cfg as CoreConfig, accountId });
      return Boolean(account.token);
    },
  }),
  introNote: {
    title: "MAX bot setup",
    lines: [
      "1) Register the bot at dev.max.ru (requires verified Russian legal entity)",
      "2) Copy the bot token from the dev.max.ru dashboard",
      "3) Either paste it here, point at a token file, or export MAX_BOT_TOKEN",
      `Docs: ${formatDocsLink("/channels/max-messenger", "channels/max-messenger")}`,
    ],
    shouldShow: ({ cfg, accountId }) => {
      const account = resolveMaxAccount({ cfg: cfg as CoreConfig, accountId });
      return !account.token;
    },
  },
  credentials: [
    {
      inputKey: "token",
      providerHint: channel,
      credentialLabel: "bot token",
      preferredEnvVar: MAX_BOT_TOKEN_ENV,
      envPrompt: `${MAX_BOT_TOKEN_ENV} detected. Use env var?`,
      keepPrompt: "MAX bot token already configured. Keep it?",
      inputPrompt: "Enter MAX bot token",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }) => {
        const account = resolveMaxAccount({ cfg: cfg as CoreConfig, accountId });
        return {
          accountConfigured: Boolean(account.token),
          hasConfiguredValue: Boolean(
            hasConfiguredSecretInput(account.config.token) || account.config.tokenFile,
          ),
          resolvedValue: account.token || undefined,
          envValue:
            accountId === DEFAULT_ACCOUNT_ID
              ? normalizeOptionalString(process.env[MAX_BOT_TOKEN_ENV])
              : undefined,
        };
      },
      applyUseEnv: async (params) => {
        return clearMaxAccountFields(params.cfg as CoreConfig, params.accountId, [
          "token",
          "tokenFile",
        ]);
      },
      applySet: async (params) =>
        setMaxAccountConfig(
          clearMaxAccountFields(params.cfg as CoreConfig, params.accountId, ["token", "tokenFile"]),
          params.accountId,
          { token: params.value },
        ),
    },
  ],
  textInputs: [],
  dmPolicy: maxMessengerDmPolicy,
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};
