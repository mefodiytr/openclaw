# MAX Channel Plugin — Implementation Plan

Companion docs: `docs/max-plugin/CONTEXT.md` (project goals/owner/status) and `docs/max-plugin/max-api-reference.md` (curated MAX API summary).

This plan is grounded in the actual structure of two existing channel plugins in this repo: `extensions/telegram/` (closest analog: Bot API, polling+webhook, multi-account) and `extensions/nextcloud-talk/` (simpler reference: webhook-only with multi-account). All file/line references below are to the current `main` branch.

---

## 1. Target file layout — `extensions/max/`

The structure mirrors `extensions/nextcloud-talk/` (the simpler reference), with a few additions to support the polling transport that `extensions/telegram/` already does well.

```
extensions/max/
├── package.json                    # Workspace package + openclaw block
├── openclaw.plugin.json            # Plugin manifest (id, channels, channelEnvVars)
├── tsconfig.json                   # Mirror nextcloud-talk/tsconfig.json
├── README.md                       # Short overview, link to docs/channels/max
│
├── index.ts                        # Entry: defineBundledChannelEntry({...})
├── channel-plugin-api.ts           # Re-export src/channel.ts → maxPlugin
├── secret-contract-api.ts          # Re-export src/secret-contract.ts → channelSecrets
├── runtime-api.ts                  # Internal cross-module re-exports (types/runtime helpers)
├── runtime-setter-api.ts           # Re-export setMaxRuntime from src/runtime.ts
├── setup-entry.ts                  # Cold-path setup metadata (used by `openclaw channels list`)
├── doctor-contract-api.ts          # (Phase ≥3) doctor diagnostics barrel
│
└── src/
    ├── channel.ts                  # createChatChannelPlugin({ base, security, pairing, outbound })
    ├── channel-api.ts              # Internal type alias barrel (mirrors nextcloud-talk/src/channel-api.ts)
    ├── accounts.ts                 # ResolvedMaxAccount + resolveMaxAccount
    ├── account-config.ts           # mergeMaxAccountConfig (top-level + accounts.<id>)
    ├── account-selection.ts        # listMaxAccountIds, resolveDefaultMaxAccountSelection
    ├── token.ts                    # resolveMaxToken (env / tokenFile / config)
    ├── types.ts                    # MaxAccountConfig, CoreConfig, MaxInboundMessage, etc.
    ├── config-schema.ts            # Zod schema (MaxConfigSchema) — mirrors nextcloud-talk
    │
    ├── client.ts                   # Lightweight wrapper around @maxhub/max-bot-api (Bot)
    ├── runtime.ts                  # Runtime registry (getMaxRuntime / setMaxRuntime)
    │
    ├── monitor.ts                  # Transport orchestration (selects polling vs webhook)
    ├── monitor-polling.runtime.ts  # Long-polling loop using SDK.start()
    ├── monitor-webhook.runtime.ts  # HTTP webhook listener (Phase 2)
    │
    ├── inbound.ts                  # handleMaxInbound — DM/group gating + dispatchInboundReplyWithBase
    ├── handlers.ts                 # Per-event normalizers: message_created, message_callback, ...
    ├── normalize.ts                # normalizeMaxMessagingTarget, looksLikeMaxTargetId
    ├── policy.ts                   # Group policy / room policy (Phase ≥3)
    ├── send.ts                     # sendMessageMax (text + attachments)
    ├── send.runtime.ts             # Lazy runtime delegate
    ├── attachments.ts              # (Phase 4) two-step upload helper
    │
    ├── session-route.ts            # resolveMaxOutboundSessionRoute (thread-aware route)
    ├── secret-contract.ts          # secretTargetRegistryEntries + collectRuntimeConfigAssignments
    ├── secret-input.ts             # Local secret-input zod schema helper
    ├── setup-core.ts               # ChannelSetupAdapter (validateInput + applyAccountConfig)
    ├── setup-surface.ts            # Setup wizard (interactive prompts)
    ├── replay-guard.ts             # (Phase 2) webhook dedupe by messageId
    ├── signature.ts                # (Phase 2) webhook signature verification (if MAX adds one)
    └── doctor.ts                   # (Phase ≥3) config diagnostics

# Test files (Phase 6) live alongside production files as `*.test.ts`
# (e.g. `src/accounts.test.ts`, `src/inbound.replay.test.ts`).
```

Phase mapping for this layout:
- **Phase 1 (MVP)** ships everything required for `polling + message_created → reply text`:
  `package.json`, `openclaw.plugin.json`, `tsconfig.json`, `index.ts`, `channel-plugin-api.ts`, `secret-contract-api.ts`, `runtime-api.ts`, `runtime-setter-api.ts`, `setup-entry.ts`, plus `src/{channel.ts, channel-api.ts, accounts.ts, account-config.ts, account-selection.ts, token.ts, types.ts, config-schema.ts, client.ts, runtime.ts, monitor.ts, monitor-polling.runtime.ts, inbound.ts, handlers.ts, normalize.ts, send.ts, send.runtime.ts, session-route.ts, secret-contract.ts, secret-input.ts, setup-core.ts, setup-surface.ts}`.
- **Phase 2** adds `monitor-webhook.runtime.ts`, `replay-guard.ts`, `signature.ts`.
- **Phase 3** adds keyboard handling in `handlers.ts` (no new file).
- **Phase 4** adds `attachments.ts` and extends `send.ts`.
- **Phase 5** is config-only.
- **Phase 6** adds `*.test.ts` files.

---

## 2. Manifest files (ready to copy)

### 2.1 `extensions/max/package.json`

Modeled on `extensions/nextcloud-talk/package.json:1-60` (closer fit than Telegram, since MAX has no Grammy ecosystem to depend on yet).

```json
{
  "name": "@openclaw/max",
  "version": "2026.5.3",
  "description": "OpenClaw MAX channel plugin (Russian messenger by VK)",
  "repository": {
    "type": "git",
    "url": "https://github.com/openclaw/openclaw"
  },
  "type": "module",
  "dependencies": {
    "@maxhub/max-bot-api": "^0.0.13",
    "zod": "^4.4.1"
  },
  "devDependencies": {
    "@openclaw/plugin-sdk": "workspace:*",
    "openclaw": "workspace:*"
  },
  "peerDependencies": {
    "openclaw": ">=2026.5.3"
  },
  "peerDependenciesMeta": {
    "openclaw": {
      "optional": true
    }
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "max",
      "label": "MAX",
      "selectionLabel": "MAX (Russian messenger)",
      "detailLabel": "MAX bot",
      "docsPath": "/channels/max",
      "docsLabel": "max",
      "blurb": "Russian messenger MAX (by VK). Requires a verified Russian legal entity to register a bot at dev.max.ru.",
      "aliases": ["max-messenger"],
      "order": 70,
      "markdownCapable": true,
      "configuredState": {
        "env": { "allOf": ["MAX_BOT_TOKEN"] },
        "specifier": "./configured-state",
        "exportName": "hasMaxConfiguredState"
      }
    },
    "compat": {
      "pluginApi": ">=2026.5.3"
    }
  }
}
```

Key choices and references:
- `name: "@openclaw/max"` — same convention as `extensions/nextcloud-talk/package.json:2`.
- `dependencies`: only `@maxhub/max-bot-api` (transport) and `zod` (config schema, same as nextcloud-talk). No grammy fork because the MAX SDK is its own thing.
- `openclaw.extensions: ["./index.ts"]` — required for plugin loader (see `extensions/CLAUDE.md` "Boundary Rules"). All bundled plugins use this pattern; see `extensions/telegram/package.json:18-20`.
- `openclaw.setupEntry: "./setup-entry.ts"` — required so `openclaw channels list` and `status` can read MAX metadata before runtime loads (see `docs/plugins/sdk-channel-plugins.md:160-164`).
- `openclaw.channel.id: "max"` — primary channel id. Becomes `channels.max.*` in user config.
- `openclaw.channel.aliases: ["max-messenger"]` — accepted by target prefix parsing (mirrors nextcloud-talk's `["nc-talk", "nc"]`, `extensions/nextcloud-talk/package.json:38-40`).
- `openclaw.channel.configuredState.env.allOf` — env presence enables a quick "configured" answer without reading config (see `extensions/telegram/package.json:46-50`).
- `openclaw.compat.pluginApi: ">=2026.5.3"` — gate against older host (mirrors nextcloud-talk).

Skipped vs Telegram:
- `setupFeatures.legacyStateMigrations` — not needed; we have no prior state to migrate.
- `setupFeatures.configPromotion` — defer until Phase 3+ when env-driven onboarding becomes useful.
- `install.npmSpec` and `release.publishToClawHub` — defer until upstream contribution decision is made.

### 2.2 `extensions/max/openclaw.plugin.json`

Modeled on `extensions/telegram/openclaw.plugin.json:1-15`.

```json
{
  "id": "max",
  "activation": { "onStartup": false },
  "channels": ["max"],
  "channelEnvVars": {
    "max": ["MAX_BOT_TOKEN"]
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

Notes:
- `activation.onStartup: false` — channel only starts when an account is configured; matches `extensions/telegram/openclaw.plugin.json:3-5` and `extensions/nextcloud-talk/openclaw.plugin.json:3-5`.
- `channels: ["max"]` — discovery-time channel id list.
- `channelEnvVars.max: ["MAX_BOT_TOKEN"]` — generic startup paths can reason about env-driven configuration without loading runtime (see `docs/plugins/sdk-channel-plugins.md:154-157`).
- `configSchema` stays empty: the channel-specific schema lives at `channels.max.*` and is provided by `buildChannelConfigSchema(MaxConfigSchema)` inside `src/channel.ts`. See `extensions/nextcloud-talk/src/channel.ts:83`. (The newer pattern in `docs/plugins/sdk-channel-plugins.md:333-368` would also accept a `channelConfigs.max.schema` block here, but no bundled channel uses it yet — sticking with the in-code schema keeps consistency with telegram/nextcloud-talk.)

### 2.3 `extensions/max/tsconfig.json`

One-line file; copy `extensions/nextcloud-talk/tsconfig.json` verbatim. No MAX-specific changes needed.

---

## 3. SDK interfaces to implement

All public types are in `packages/plugin-sdk/`, which is a re-export barrel for `src/plugin-sdk/*` (see `packages/plugin-sdk/src/`). Per `extensions/CLAUDE.md` "Boundary Rules", extension production code imports only from `openclaw/plugin-sdk/*` and local barrels — never from `src/channels/**` directly.

### 3.1 `ChannelPlugin<ResolvedAccount>` — the main contract

- Definition: `src/channels/plugins/types.plugin.ts` (re-exported via `openclaw/plugin-sdk/channel-core`)
- We instantiate it through `createChatChannelPlugin({...})` from `openclaw/plugin-sdk/channel-core`, exactly like:
  - `extensions/nextcloud-talk/src/channel.ts:68-195`
  - `extensions/telegram/src/channel.ts` (similar shape, more adapters wired)

The adapters we need to fill in for MAX (Phase 1 minimum bolded):

| Adapter | Phase | Source of truth in this repo |
|---|---|---|
| **`id: "max"`** | 1 | `extensions/nextcloud-talk/src/channel.ts:71` |
| **`meta`** (label/docsPath/blurb) | 1 | `extensions/nextcloud-talk/src/channel.ts:34-44` |
| **`capabilities`** | 1 | `extensions/nextcloud-talk/src/channel.ts:74-81` |
| **`reload.configPrefixes: ["channels.max"]`** | 1 | `extensions/nextcloud-talk/src/channel.ts:82` |
| **`configSchema: buildChannelConfigSchema(MaxConfigSchema)`** | 1 | `extensions/nextcloud-talk/src/channel.ts:83` |
| **`config: ChannelConfigAdapter`** | 1 | `extensions/nextcloud-talk/src/channel.ts:84-96` (via `nextcloudTalkConfigAdapter` in `channel.adapters.ts`) |
| **`messaging: ChannelMessagingAdapter`** | 1 | `extensions/nextcloud-talk/src/channel.ts:121-129` |
| **`secrets: { secretTargetRegistryEntries, collectRuntimeConfigAssignments }`** | 1 | `extensions/nextcloud-talk/src/channel.ts:130-133`, schema in `extensions/nextcloud-talk/src/secret-contract.ts` |
| **`status: createComputedAccountStatusAdapter({...})`** | 1 | `extensions/nextcloud-talk/src/channel.ts:135-152` |
| **`gateway: ChannelGatewayAdapter`** | 1 | `extensions/nextcloud-talk/src/gateway.ts:14-43` (we adapt this for polling) |
| **`outbound: { base, attachedResults }`** | 1 | `extensions/nextcloud-talk/src/channel.ts:167-194` |
| `security: ChannelSecurityAdapter` | 1 | `extensions/nextcloud-talk/src/channel.ts:163-166` (DM policy / allowFrom) |
| `pairing.text` | 1 | `extensions/nextcloud-talk/src/channel.ts:155-162` |
| `setup: ChannelSetupAdapter` | 1 | `extensions/nextcloud-talk/src/setup-core.ts:199-248` |
| `setupWizard` | 2 | `extensions/nextcloud-talk/src/setup-surface.ts` |
| `groups: { resolveRequireMention, resolveToolPolicy }` | 3 | `extensions/nextcloud-talk/src/channel.ts:99-120` |
| `approvalCapability` | 3 | `extensions/nextcloud-talk/src/channel.ts:97` |
| `doctor` | 3 | `extensions/nextcloud-talk/src/channel.ts:98` |

### 3.2 SDK helpers we will lean on

Resolved by reading the actual imports in nextcloud-talk and telegram. All paths under `openclaw/plugin-sdk/*`.

| Helper | Subpath | Used at |
|---|---|---|
| `createChatChannelPlugin` | `channel-core` | `extensions/nextcloud-talk/src/channel.ts:2` |
| `buildChannelConfigSchema` | (re-exported via local `channel-api.ts`) | `extensions/nextcloud-talk/src/channel.ts:12` |
| `defineBundledChannelEntry` | `channel-entry-contract` | `extensions/nextcloud-talk/index.ts:1` |
| `createAccountListHelpers`, `resolveMergedAccountConfig`, `resolveAccountWithDefaultFallback`, `DEFAULT_ACCOUNT_ID`, `normalizeAccountId` | `account-core` | `extensions/nextcloud-talk/src/accounts.ts:1-7` |
| `tryReadSecretFileSync` | `secret-file-runtime` | `extensions/nextcloud-talk/src/accounts.ts:8` |
| `normalizeOptionalString`, `normalizeLowercaseStringOrEmpty` | `text-runtime` | `extensions/nextcloud-talk/src/accounts.ts:9-12` |
| `DmPolicySchema`, `GroupPolicySchema`, `MarkdownConfigSchema`, `ReplyRuntimeConfigSchemaShape`, `ToolPolicySchema`, `requireOpenAllowFrom` | `channel-config-schema` | `extensions/nextcloud-talk/src/config-schema.ts:1-7` |
| `requireChannelOpenAllowFrom`, `runStoppablePassiveMonitor` | `extension-shared` | `extensions/nextcloud-talk/src/config-schema.ts:8`, `extensions/nextcloud-talk/src/gateway.ts:2` |
| `createAccountStatusSink` | `channel-lifecycle` | `extensions/nextcloud-talk/src/gateway.ts:1` |
| `describeWebhookAccountSnapshot`, `buildWebhookChannelStatusSummary`, `createComputedAccountStatusAdapter`, `createDefaultChannelRuntimeState` | `account-helpers` / `status-helpers` | `extensions/nextcloud-talk/src/channel.ts:1, 5-9` |
| `createLoggedPairingApprovalNotifier` | `channel-pairing` | `extensions/nextcloud-talk/src/channel.ts:3` |
| `createAllowlistProviderRouteAllowlistWarningCollector` | `channel-policy` | `extensions/nextcloud-talk/src/channel.ts:4` |
| `dispatchInboundReplyWithBase`, `deliverFormattedTextWithAttachments`, `createChannelPairingController` | `runtime-api.ts` (local barrel re-exports core helpers) | `extensions/nextcloud-talk/src/inbound.ts:2-16` |
| `WEBHOOK_RATE_LIMIT_DEFAULTS`, `createAuthRateLimiter`, `readRequestBodyWithLimit` | `webhook-ingress` | `extensions/nextcloud-talk/src/monitor.ts:3-9` (Phase 2) |
| `ChannelSetupAdapter`, `ChannelSetupInput` | `channel-setup` | `extensions/nextcloud-talk/src/setup-core.ts:1` |
| `patchScopedAccountConfig`, `applyAccountNameToChannelSection` | `setup` | `extensions/nextcloud-talk/src/setup-core.ts:5-7` |
| `createSetupInputPresenceValidator`, `mergeAllowFromEntries`, `promptParsedAllowFromForAccount`, `resolveSetupAccountId` | `setup-runtime` | `extensions/nextcloud-talk/src/setup-core.ts:8-15` |
| `formatDocsLink` | `setup-tools` | `extensions/nextcloud-talk/src/setup-core.ts:16` |
| `SecretTargetRegistryEntry`, `collectConditionalChannelFieldAssignments`, `getChannelSurface`, `hasOwnProperty` | `channel-secret-basic-runtime` | `extensions/nextcloud-talk/src/secret-contract.ts:1-8` |

### 3.3 `defineBundledChannelEntry` — entry point shape

Source: `src/plugin-sdk/channel-entry-contract.ts` (re-exported via `openclaw/plugin-sdk/channel-entry-contract`).

Reference call: `extensions/nextcloud-talk/index.ts:3-20`. Our MAX `index.ts` mirrors that 1:1, only changing ids and exportNames. Notably: this is the **bundled-plugin** form. The newer `defineChannelPluginEntry` form documented in `docs/plugins/sdk-channel-plugins.md:506-535` is intended for external/ClawHub plugins; bundled channels still use `defineBundledChannelEntry` because it supports lazy specifiers (`{ specifier, exportName }`) so discovery doesn't pull runtime modules. We follow the bundled pattern.

---

## 4. MAX events → OpenClaw channel events mapping

Telegram is the canonical reference for "Bot API style platform with discrete update types". Its update routing lives in `extensions/telegram/src/bot-message-dispatch.ts:114-400`, which receives a normalized `TelegramMessageContext` from polling (`monitor-polling.runtime.ts`) or webhook (`monitor-webhook.runtime.ts`) and calls `runInboundReplyTurn(...)` for actionable messages.

Nextcloud-talk's webhook-only flow in `extensions/nextcloud-talk/src/inbound.ts:54-320` is the cleaner shape to copy because MAX has discrete event types from the start, just like Activity Streams.

| MAX event | Telegram analogue | OpenClaw inbound action | Phase | Notes |
|---|---|---|---|---|
| `bot_started` | `my_chat_member` (status → member) | Send `meta.welcomeMessage` if configured; create pairing record if DM and `dmPolicy === "pairing"`. | 1 | First user contact. Mirror `nextcloud-talk` pairing flow at `extensions/nextcloud-talk/src/inbound.ts:175-196` (issue pairing challenge). |
| `message_created` (text) | `message` (with `text`) | `payloadToInboundMessage` (see `extensions/nextcloud-talk/src/monitor.ts:197-214`) → `handleMaxInbound` → `dispatchInboundReplyWithBase` (see `extensions/nextcloud-talk/src/inbound.ts:289-319`). | 1 | Core MVP path. |
| `message_created` (with attachments) | `message` (with `photo`/`video`/`document`) | Same as above + media descriptor on the inbound context. Initial implementation: pass attachment URL/caption as text fallback. Phase 4 wires real media download. | 4 | Telegram does this in `extensions/telegram/src/bot-message-context.body.test.ts` (parses photo/video/file/voice/sticker variants). |
| `message_callback` | `callback_query` | Phase 3: route via `approvalCapability` for native approval buttons OR via `actions` adapter for in-message commands. The button payload's `payload` field maps to Telegram's `callback_data`. | 3 | Telegram callback dispatch lives in `extensions/telegram/src/bot-message-dispatch.ts` together with `bot/native-quote.js` button helpers. |
| `message_edited` | `edited_message` | Phase 1 minimum: ignore (idempotent for agent state). Phase 3+: re-dispatch as a fresh inbound context tagged `WasEdit: true` if config asks. | 1 (drop) / 3 (route) | Telegram drops by default unless `actions.edits` is enabled per-account. |
| `message_removed` | `chat_member` (left) | Drop in Phase 1. Optional audit log in Phase 3. | 1 (drop) | No agent action needed for MVP. |
| `bot_added` | `my_chat_member` (added to chat) | Phase 1: log only. Phase 3: trigger room registration if `groupPolicy === "allowlist"`. | 1 (log) / 3 | |
| `bot_removed` | `my_chat_member` (kicked) | Drop, log only. | 1 | |
| `user_added` | `chat_member` joined | Drop, log only. | 1 | |
| `user_removed` | `chat_member` left | Drop, log only. | 1 | |
| `chat_title_changed` | `message` (with `new_chat_title`) | Drop, log only. Could refresh cached room name. | 1 | |

Inbound message normalization shape (mirror `extensions/nextcloud-talk/src/types.ts:151-161` and `extensions/nextcloud-talk/src/monitor.ts:197-214`):

```typescript
// src/types.ts
export type MaxInboundMessage = {
  messageId: string;          // MAX message id
  chatId: string;             // MAX chat id (DM: peer user id; group: chat id)
  chatTitle?: string;         // group title (undefined for DM)
  senderId: string;           // MAX user id (numeric → string)
  senderName: string;         // first_name / display name
  text: string;               // message.body.text
  attachments: MaxAttachment[]; // [] in Phase 1; populated in Phase 4
  timestamp: number;          // ms
  isGroupChat: boolean;
  replyToMessageId?: string;  // for native reply threading
};
```

Dispatch flow for `message_created` (Phase 1 — copy nextcloud-talk's `handleNextcloudTalkInbound` shape from `extensions/nextcloud-talk/src/inbound.ts:54-320`):

1. Drop if empty text.
2. Resolve allowFrom / dmPolicy / groupPolicy via `resolveDmGroupAccessWithCommandGate(...)` (helper from `runtime-api.ts`, see `extensions/nextcloud-talk/src/inbound.ts:138-156`).
3. If decision is `"pairing"` — issue challenge through `pairing.issueChallenge(...)` (`inbound.ts:177-191`).
4. If decision is `"drop"` — `runtime.log` and return.
5. Mention gating for groups — Phase 3, optional; Phase 1 treats every group message that passes allowlist as actionable.
6. Build inbound context via `core.channel.reply.finalizeInboundContext({...})` (`inbound.ts:264-287`).
7. Dispatch via `dispatchInboundReplyWithBase({...})` (`inbound.ts:289-319`) with a `deliver` that calls `sendMessageMax(chatId, text, {...})`.

---

## 5. Channel config — JSON Schema for `channels.max`

We follow the **nextcloud-talk model** (Zod schema in `src/config-schema.ts`, TypeScript types in `src/types.ts`) rather than Telegram's heavier typebox approach, because nextcloud-talk's schema is closer in surface area to what MAX needs.

Reference: `extensions/nextcloud-talk/src/config-schema.ts` (full file shown in survey above) and `extensions/nextcloud-talk/src/types.ts:9-90`.

### 5.1 `MaxAccountConfig` (TS type, `src/types.ts`)

```typescript
import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  SecretInput,
} from "../runtime-api.js";

export type MaxTransport = "polling" | "webhook";

export type MaxAccountConfig = {
  /** Optional display name for this account (CLI/UI). */
  name?: string;
  /** Default true; set false to disable this MAX account without removing it. */
  enabled?: boolean;

  /** Bot token issued by dev.max.ru. Mutually exclusive with tokenFile. */
  token?: SecretInput;
  /** Path to file containing the bot token (for secret managers). */
  tokenFile?: string;

  /** Optional API base URL override (default: https://platform-api.max.ru). */
  apiRoot?: string;

  /** Transport: "polling" (default) or "webhook". */
  transport?: MaxTransport;
  /** Public URL passed to set_webhook (only used when transport === "webhook"). */
  webhookUrl?: string;
  /** Webhook server local port. Default: 8789. */
  webhookPort?: number;
  /** Webhook server local host. Default: "0.0.0.0". */
  webhookHost?: string;
  /** Webhook endpoint path. Default: "/max-webhook". */
  webhookPath?: string;

  /** DM policy: "allowlist" | "open" | "pairing". Default: "pairing". */
  dmPolicy?: DmPolicy;
  /** User ids allowed to DM the bot (when dmPolicy === "allowlist"). */
  allowFrom?: string[];

  /** Group policy: "allowlist" | "open" | "blocked". Default: "allowlist". */
  groupPolicy?: GroupPolicy;
  /** User ids allowed to address the bot in group chats. */
  groupAllowFrom?: string[];

  /** Per-DM overrides keyed by user id. */
  dms?: Record<string, DmConfig>;

  /** Outbound text chunk size (chars). MAX limit is roughly 4000; verify (open question). Default: 4000. */
  textChunkLimit?: number;
  /** Disable block streaming for MAX (recommended initially: true). */
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /** Outbound response prefix override. */
  responsePrefix?: string;
  /** Media upload max size in MB. Default: 50. */
  mediaMaxMb?: number;
};

type MaxConfig = {
  /** Per-account configuration (multi-account). */
  accounts?: Record<string, MaxAccountConfig>;
  /** Default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & MaxAccountConfig;

export type CoreConfig = {
  channels?: { max?: MaxConfig };
  [key: string]: unknown;
};
```

### 5.2 `MaxConfigSchema` (Zod, `src/config-schema.ts`)

Lifted directly from the nextcloud-talk pattern with MAX-specific fields. The `dmPolicy`/`allowFrom` shape uses the shared SDK schemas so dmPolicy validation matches every other channel.

```typescript
import {
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { requireChannelOpenAllowFrom } from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";
import { buildSecretInputSchema } from "./secret-input.js";

const MaxTransportSchema = z.enum(["polling", "webhook"]);

const MaxAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    markdown: MarkdownConfigSchema,

    token: buildSecretInputSchema().optional(),
    tokenFile: z.string().optional(),
    apiRoot: z.string().url().optional(),

    transport: MaxTransportSchema.optional().default("polling"),
    webhookUrl: z.string().url().optional(),
    webhookPort: z.number().int().positive().optional(),
    webhookHost: z.string().optional(),
    webhookPath: z.string().optional(),

    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.string()).optional(),

    ...ReplyRuntimeConfigSchemaShape, // textChunkLimit, blockStreaming, etc.
  })
  .strict();

const MaxAccountSchema = MaxAccountSchemaBase.superRefine((value, ctx) => {
  requireChannelOpenAllowFrom({
    channel: "max",
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    requireOpenAllowFrom,
  });
  if (value.transport === "webhook" && !value.webhookUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "channels.max: webhookUrl is required when transport is 'webhook'.",
      path: ["webhookUrl"],
    });
  }
});

export const MaxConfigSchema = MaxAccountSchemaBase.extend({
  accounts: z.record(z.string(), MaxAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireChannelOpenAllowFrom({
    channel: "max",
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    requireOpenAllowFrom,
  });
});
```

### 5.3 Comparison with the Telegram plugin

| Field | MAX shape (this plan) | Telegram equivalent | Notes |
|---|---|---|---|
| `token` (`SecretInput`) | direct | `botToken` | MAX uses the simpler "token" naming; Telegram inherited `botToken`. Internally we resolve via `resolveMaxToken()` mirroring `extensions/telegram/src/token.ts`. |
| `tokenFile` | direct | `tokenFile` | Same. |
| `apiRoot` | direct | `apiRoot` | Allows pinning `https://platform-api.max.ru` (default) or test endpoints. Same as `extensions/telegram/src/accounts.ts:117`. |
| `transport: "polling" \| "webhook"` | explicit field | implicit (presence of `webhookUrl` switches to webhook) | MAX makes this explicit because the API requires `delete_webhook` before polling resumes. Explicit field surfaces the constraint in config and in doctor. |
| `webhookUrl`, `webhookPort`, `webhookHost`, `webhookPath` | direct | direct | Same shape as Telegram. |
| `dmPolicy`, `allowFrom` | shared `DmPolicySchema` | shared `DmPolicySchema` | Identical contract — see `openclaw/plugin-sdk/channel-config-schema`. |
| `groupPolicy`, `groupAllowFrom` | shared | shared | Same. |
| `accounts: Record<string, MaxAccountConfig>` | direct | direct | Multi-account mirror. |
| `defaultAccount` | direct | implicit (`accounts.default`) | Telegram uses `accounts.default` key; nextcloud-talk uses `defaultAccount` field — MAX follows the cleaner nextcloud-talk pattern. |

Top-level config example users will write into `~/.openclaw/openclaw.json`:

```jsonc
{
  "channels": {
    "max": {
      // Single-account form (Phase 1 MVP)
      "tokenFile": "~/.openclaw/credentials/max-bcai.token",
      "transport": "polling",
      "dmPolicy": "allowlist",
      "allowFrom": ["12345678"],

      // Multi-account form (Phase 5)
      "accounts": {
        "bcai": { "tokenFile": "~/.openclaw/credentials/max-bcai.token" },
        "test": { "token": "$MAX_BOT_TOKEN_TEST", "transport": "webhook", "webhookUrl": "https://example.com/max-test" }
      },
      "defaultAccount": "bcai"
    }
  }
}
```

---

## 6. Phased PR plan

Each phase is a single feature branch + PR, sized to fit one mobile review session and verifiable on BCAi by pulling the merged main. Test commands assume sparse-friendly invocations from `CLAUDE.md` "Commands" section.

### Phase 1 — MVP: polling + `message_created` + plain text reply

Goal: `openclaw start` brings up the bot, a real DM to the bot triggers an agent reply.

In scope:
- All Phase 1 files from §1 above.
- `client.ts` wraps `@maxhub/max-bot-api` `Bot` with one method per outbound op needed (`sendMessage` only) and one `start(handler)` for polling. No webhook.
- `monitor.ts` selects polling unconditionally (webhook config rejected with friendly error).
- `inbound.ts` handles `message_created` (text only). All other events: `runtime.log` and ignore.
- `send.ts` only implements `sendText` via `client.sendMessage`. No attachments, no chunker beyond the SDK default.
- `setup-core.ts` validates `--token` / `--token-file` / `--use-env` and writes account config; no interactive wizard yet.
- `dmPolicy: "pairing"` with built-in pairing (reuse `createChannelPairingController`).
- Single account only — `defaultAccount`/`accounts` keys still parse but resolution always uses the top-level fields.

Tests / proof:
- `pnpm test extensions/max` must pass (one happy-path account-resolution test, one config-schema test).
- Manual on BCAi: send DM "ping" → bot replies "pong" via test agent (Mikhail does this part).

Branch: `feat/max-plugin-mvp`. PR title: `feat(max): channel plugin MVP — polling + message_created`.

### Phase 2 — Webhook transport

In scope:
- `monitor-webhook.runtime.ts` mirrors `extensions/nextcloud-talk/src/monitor.ts:228-385` (HTTP listener, body limit, rate limiter, healthz).
- `replay-guard.ts` mirrors `extensions/nextcloud-talk/src/replay-guard.ts` (in-memory dedupe by `(accountId, chatId, messageId)`).
- `signature.ts` — only if MAX adds signed webhooks; otherwise document plaintext POST limitation and require operator network controls. **Open question — see §7.**
- Doctor warning when both `transport: "webhook"` and `webhookUrl` missing, or vice versa.
- Lifecycle: on switch from webhook → polling, call `delete_webhook` first (per MAX docs §Transports).

Tests:
- Webhook handler unit tests (`monitor.replay.test.ts`-style).
- E2E: BCAi pairs with a public Cloudflare tunnel, real MAX → tunnel → BCAi → reply.

Branch: `feat/max-webhook-transport`. PR title: `feat(max): webhook transport`.

### Phase 3 — Callback buttons + inline keyboard

In scope:
- `handlers.ts` route for `message_callback`.
- `send.ts` extension: `attachments` parameter accepts `CallbackButton[] | LinkButton[]` and serializes to MAX `attachments` schema (per `docs/max-plugin/max-api-reference.md` "Keyboards & buttons").
- `approvalCapability` wired through `createApproverRestrictedNativeApprovalCapability` (see `docs/plugins/sdk-channel-plugins.md:91`) so `/approve` flows can render MAX buttons. Alternatively, ship the simpler "no native approvals" path first and rely on text `/approve`.
- `groups.resolveRequireMention` and `groups.resolveToolPolicy` ported from `extensions/nextcloud-talk/src/channel.ts:99-120`.
- `setupWizard` (interactive): prompt for token, dmPolicy, allowFrom — port `extensions/nextcloud-talk/src/setup-surface.ts`.

Tests: callback round-trip unit test; approval render snapshot.

Branch: `feat/max-keyboards`. PR title: `feat(max): inline keyboards and callback buttons`.

### Phase 4 — Attachments (images, files)

In scope:
- `attachments.ts` implements MAX two-step upload (`POST /uploads` → put binary → reference token).
- `send.ts` `sendMedia(...)` wires `mediaUrl` into a downloaded buffer + uploaded token.
- Inbound: parse `attachments[]` in `message_created`, expose first image/file via `MaxInboundMessage.attachments`.
- Capability flag `media: true` flips on (was `false` in Phase 1).

Tests: mock `fetch` for upload presign; verify outbound serializes `attachments[{ token }]` correctly.

Branch: `feat/max-attachments`. PR title: `feat(max): attachments (image/file send and receive)`.

### Phase 5 — Multi-account support

In scope:
- Promote `account-config.ts` and `account-selection.ts` to use `accounts.*` and `defaultAccount` fully (Phase 1 stub becomes real).
- `secret-contract.ts` adds `channels.max.accounts.*.token` entries (mirror `extensions/nextcloud-talk/src/secret-contract.ts:11-55`).
- Status snapshot per-account.
- CLI: `openclaw max status [--account <id>]` lists configured accounts (via `registerCli` in `index.ts`).

Tests: account merge / default-account fallback / disabled-account skip.

Branch: `feat/max-multi-account`. PR title: `feat(max): multi-account support`.

### Phase 6 — Test sweep

Bring coverage up to nextcloud-talk levels (~10 test files). Targets:
- `accounts.test.ts` — token resolution sources.
- `config-schema.test.ts` — invalid configs rejected with helpful messages.
- `inbound.test.ts` — DM/group/pairing decisions.
- `inbound.replay.test.ts` — dedupe (Phase 2 carry-over).
- `send.test.ts` — chunking, reply-to threading.
- `setup.test.ts` — setup adapter validates inputs and writes config.
- `doctor.test.ts` — diagnostic messages for misconfig.
- `policy.test.ts` — group allowlist matching.
- `gateway.test.ts` — startAccount / logoutAccount.
- `e2e.test.ts` — opt-in (`OPENCLAW_LIVE_TEST=1`) full polling round-trip with a fake bot server.

Then update `docs/channels/max.md` and `docs/install/*` references; add MAX to plugin inventory.

Branch: `chore/max-tests`. PR title: `chore(max): add unit and integration tests`.

---

## 7. Open questions (need Mikhail's answers before Phase 1 codes)

Numbered so they can be answered inline as a PR comment.

1. **Bot registration timeline.** Phase 1 cannot be smoke-tested without a real `MAX_BOT_TOKEN`. Has the legal entity (ООО «Бизнес-Климат Контрол» or ООО «BS FM») already started moderation at dev.max.ru? Approximate ETA?
2. **Channel id `"max"` vs `"max-messenger"`.** I propose `id: "max"` (short, matches user-facing branding). The aliases `["max-messenger"]` accept the longer form. If you'd prefer `"max-messenger"` as primary (to avoid clashing with future Anthropic "max" model labels in CLI completion), say so now — it's harder to rename later.
3. **Webhook signature.** `docs/max-plugin/max-api-reference.md` doesn't list a webhook signature header. Confirm that MAX webhook delivery is unsigned plaintext POST (in which case Phase 2 mandates HTTPS + secret URL path + IP allowlist) or point me at the signature spec if one exists.
4. **dmPolicy default.** Russian-language onboarding might want different defaults — should default `dmPolicy` be `"pairing"` (like nextcloud-talk and Telegram) or `"allowlist"` (more conservative)?
5. **Multi-account in Phase 1.** Phase 1 ships single-account only; multi-account is Phase 5. OK to defer, or do you need prod + staging in parallel from day one?
6. **MAX message length limit.** Listed as open question in `max-api-reference.md`. Phase 1 uses `textChunkLimit: 4000` (Telegram default). Is that right for MAX?
7. **Block-streaming default.** Nextcloud-talk sets `blockStreaming: true` (suppress streaming, send final block only) and Telegram defaults to streaming. MAX has no documented streaming UX — propose `blockStreaming: true` in Phase 1. Confirm?
8. **Reference to `docs/tools/plugin.md`.** That path doesn't exist in this repo; the actual authoring docs live at `docs/plugins/building-plugins.md`, `docs/plugins/sdk-channel-plugins.md`, and `docs/plugins/manifest.md`. Update CONTEXT.md when convenient. (Not blocking.)
9. **`@maxhub/max-bot-api` version pin.** I plan to pin `^0.0.13` (current). Confirm acceptable, or pin tighter (e.g. exact version) until the SDK stabilizes.
10. **Upstream contribution.** Is the eventual contribution path "PR to openclaw/openclaw" or "publish standalone `@openclaw/max` to npm/ClawHub"? Affects whether to add `install.npmSpec` in `package.json` (Phase 5) and whether to follow the bundled-plugin or external-plugin entrypoint pattern (currently planned: bundled).

---

## Summary

Phase 1 PR creates ~22 files (~1500 LOC) by translating nextcloud-talk's webhook plugin into a polling plugin that uses `@maxhub/max-bot-api` as the transport. Subsequent phases each add one well-scoped feature in 200–400 LOC. The choice of nextcloud-talk over telegram as the structural template keeps the surface area small; we promote to telegram-style complexity only when MAX-specific needs require it (e.g. multi-account in Phase 5).

Total expected file count at Phase 6: roughly equal to nextcloud-talk's current ~30 files (production + tests).
