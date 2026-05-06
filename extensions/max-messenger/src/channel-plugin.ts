import {
  buildChannelConfigSchema,
  createChatChannelPlugin,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { createLoggedPairingApprovalNotifier } from "openclaw/plugin-sdk/channel-pairing";
import { maxMessengerGatewayAdapter } from "./adapters/gateway.adapter.js";
import {
  maxMessengerConfigAdapter,
  maxMessengerPairingTextAdapter,
  maxMessengerSecurityAdapter,
} from "./adapters/identity.adapter.js";
import { maxMessengerOutboundAdapter } from "./adapters/outbound.adapter.js";
import { MaxConfigSchema } from "./config-schema.js";
import { looksLikeMaxTargetId, normalizeMaxMessagingTarget } from "./normalize.js";
import { resolveMaxGroupToolPolicy, resolveMaxRequireMention } from "./policy.js";
import { collectRuntimeConfigAssignments, secretTargetRegistryEntries } from "./secret-contract.js";
import { maxMessengerSetupAdapter } from "./setup-core.js";
import { maxMessengerSetupWizard } from "./setup-surface.js";
import type { ResolvedMaxAccount } from "./types.js";

const meta = {
  id: "max-messenger",
  label: "MAX",
  selectionLabel: "MAX (Russian messenger)",
  detailLabel: "MAX bot",
  docsPath: "/channels/max-messenger",
  docsLabel: "max-messenger",
  blurb:
    "Russian messenger MAX (by VK). Polling + agent reply + inline keyboards + media attachments (Phase 4).",
  aliases: ["max"],
  order: 70,
  markdownCapable: true,
};

/**
 * MAX Messenger channel plugin.
 *
 * Phase 1A — file layout. Phase 1B (1B.1/1B.2/1B.3) — custom polling
 * supervisor, HTTP wrapper, marker store, dedup cache, agent reply
 * pipeline. Phase 3 (this surface) — outbound inline keyboards,
 * `message_callback` acknowledgement, group helpers, interactive
 * `openclaw onboard` wizard. Phase 2 (webhook transport) and native
 * `approvalCapability` are deliberately deferred per plan §6.
 */
export const maxMessengerPlugin: ChannelPlugin<ResolvedMaxAccount> = createChatChannelPlugin({
  base: {
    id: "max-messenger",
    meta,
    setupWizard: maxMessengerSetupWizard,
    capabilities: {
      chatTypes: ["direct", "group"],
      reactions: false,
      threads: false,
      media: true,
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.max-messenger"] },
    configSchema: buildChannelConfigSchema(MaxConfigSchema),
    config: maxMessengerConfigAdapter,
    groups: {
      resolveRequireMention: resolveMaxRequireMention,
      resolveToolPolicy: resolveMaxGroupToolPolicy,
    },
    messaging: {
      targetPrefixes: ["max-messenger", "max"],
      normalizeTarget: normalizeMaxMessagingTarget,
      targetResolver: {
        looksLikeId: looksLikeMaxTargetId,
        hint: "<chatId>",
      },
    },
    secrets: {
      secretTargetRegistryEntries,
      collectRuntimeConfigAssignments,
    },
    setup: maxMessengerSetupAdapter,
    gateway: maxMessengerGatewayAdapter,
  },
  pairing: {
    text: {
      ...maxMessengerPairingTextAdapter,
      notify: createLoggedPairingApprovalNotifier(
        ({ id }) => `[max-messenger] User ${id} approved for pairing`,
      ),
    },
  },
  security: maxMessengerSecurityAdapter,
  outbound: maxMessengerOutboundAdapter,
});
