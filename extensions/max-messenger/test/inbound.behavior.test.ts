/**
 * Phase 6 behavior tests for `handleMaxInbound`.
 *
 * Mocks the runtime-api seam (so the heavy `dispatchInboundReplyWithBase`
 * + group-policy helpers do not load) and the local `send.ts` (so we can
 * assert the delivery path without hitting fetch). What we actually
 * exercise here is the routing decision: does the gate let the message
 * through? does pairing fire its challenge? do attachments surface as
 * MediaUrls? Anything below the gate is owned by the SDK helpers and is
 * tested in core.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatchInboundReplyWithBaseMock = vi.hoisted(() => vi.fn());
const createChannelPairingControllerMock = vi.hoisted(() => vi.fn());
const readStoreAllowFromForDmPolicyMock = vi.hoisted(() => vi.fn());
const resolveDmGroupAccessWithCommandGateMock = vi.hoisted(() => vi.fn());
const resolveAllowlistProviderRuntimeGroupPolicyMock = vi.hoisted(() => vi.fn());
const resolveDefaultGroupPolicyMock = vi.hoisted(() => vi.fn());
const warnMissingProviderGroupPolicyFallbackOnceMock = vi.hoisted(() => vi.fn());
const logInboundDropMock = vi.hoisted(() => vi.fn());
const deliverFormattedTextWithAttachmentsMock = vi.hoisted(() => vi.fn());

vi.mock("../src/runtime-api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/runtime-api.js")>("../src/runtime-api.js");
  return {
    ...actual,
    dispatchInboundReplyWithBase: dispatchInboundReplyWithBaseMock,
    createChannelPairingController: createChannelPairingControllerMock,
    readStoreAllowFromForDmPolicy: readStoreAllowFromForDmPolicyMock,
    resolveDmGroupAccessWithCommandGate: resolveDmGroupAccessWithCommandGateMock,
    resolveAllowlistProviderRuntimeGroupPolicy: resolveAllowlistProviderRuntimeGroupPolicyMock,
    resolveDefaultGroupPolicy: resolveDefaultGroupPolicyMock,
    warnMissingProviderGroupPolicyFallbackOnce: warnMissingProviderGroupPolicyFallbackOnceMock,
    logInboundDrop: logInboundDropMock,
    deliverFormattedTextWithAttachments: deliverFormattedTextWithAttachmentsMock,
  };
});

const sendMaxTextMock = vi.hoisted(() => vi.fn());
const sendMaxCallbackAnswerMock = vi.hoisted(() => vi.fn());

vi.mock("../src/send.js", async () => {
  const actual = await vi.importActual<typeof import("../src/send.js")>("../src/send.js");
  return {
    ...actual,
    sendMaxText: sendMaxTextMock,
    sendMaxCallbackAnswer: sendMaxCallbackAnswerMock,
  };
});

import { handleMaxInbound } from "../src/inbound.js";
import type { PluginRuntime, RuntimeEnv } from "../src/runtime-api.js";
import { setMaxRuntime } from "../src/runtime.js";
import type { CoreConfig, MaxInboundMessage, ResolvedMaxAccount } from "../src/types.js";

function installRuntime(): void {
  const runtime: PluginRuntime = {
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "default",
          accountId: "default",
          sessionKey: "max-messenger:default:1",
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/store.json"),
        readSessionUpdatedAt: vi.fn(() => undefined),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(({ body }: { body: string }) => `[envelope]${body}`),
        finalizeInboundContext: vi.fn((ctx: Record<string, unknown>) => ctx),
      },
    },
  } as unknown as PluginRuntime;
  setMaxRuntime(runtime);
}

function makeAccount(overrides: Partial<ResolvedMaxAccount["config"]> = {}): ResolvedMaxAccount {
  return {
    accountId: "default",
    enabled: true,
    token: "tk-default",
    tokenSource: "config",
    apiRoot: "https://platform-api.max.ru",
    config: { dmPolicy: "allowlist", allowFrom: ["1001"], ...overrides },
  };
}

function makeRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
  } as unknown as RuntimeEnv;
}

function makeMessage(overrides: Partial<MaxInboundMessage> = {}): MaxInboundMessage {
  return {
    messageId: "msg-1",
    chatId: "200",
    senderId: "1001",
    senderName: "Alice",
    text: "hello",
    timestamp: 1700000000000,
    isGroupChat: false,
    ...overrides,
  };
}

const baseCfg: CoreConfig = { channels: { "max-messenger": { token: "tk-default" } } };

beforeEach(() => {
  installRuntime();
  resolveDefaultGroupPolicyMock.mockReturnValue("allowlist");
  resolveAllowlistProviderRuntimeGroupPolicyMock.mockReturnValue({
    groupPolicy: "allowlist",
    providerMissingFallbackApplied: false,
  });
  readStoreAllowFromForDmPolicyMock.mockResolvedValue([]);
  createChannelPairingControllerMock.mockReturnValue({
    readStoreForDmPolicy: vi.fn(),
    issueChallenge: vi.fn(async () => undefined),
  });
  dispatchInboundReplyWithBaseMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleMaxInbound — DM gating", () => {
  it("dispatches when the sender is on the DM allowlist (decision=allow)", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage(),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).toHaveBeenCalledTimes(1);
  });

  it("drops when the gate decision is `deny` and never invokes dispatch", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "deny",
      reason: "not_allowed",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage(),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).not.toHaveBeenCalled();
  });

  it("issues a pairing challenge when the gate returns `pairing`", async () => {
    const issueChallenge = vi.fn(async () => undefined);
    createChannelPairingControllerMock.mockReturnValue({
      readStoreForDmPolicy: vi.fn(),
      issueChallenge,
    });
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "pairing",
      reason: "pairing_challenge",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage(),
      account: makeAccount({ dmPolicy: "pairing" }),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(issueChallenge).toHaveBeenCalledTimes(1);
    expect(dispatchInboundReplyWithBaseMock).not.toHaveBeenCalled();
  });

  it("blocks unauthorized control commands and never dispatches", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: true,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage(),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(logInboundDropMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "control command (unauthorized)" }),
    );
    expect(dispatchInboundReplyWithBaseMock).not.toHaveBeenCalled();
  });
});

describe("handleMaxInbound — group gating", () => {
  it("dispatches in a group when the sender is on the effective group allowlist", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "group_allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: ["1001"],
    });
    await handleMaxInbound({
      message: makeMessage({ isGroupChat: true, chatId: "999" }),
      account: makeAccount({ groupPolicy: "allowlist", groupAllowFrom: ["1001"] }),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).toHaveBeenCalledTimes(1);
  });

  it("drops in a group when the sender is not on the effective allowlist", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "group_allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: ["9999"],
    });
    await handleMaxInbound({
      message: makeMessage({ isGroupChat: true, chatId: "999" }),
      account: makeAccount({ groupPolicy: "allowlist" }),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).not.toHaveBeenCalled();
  });
});

describe("handleMaxInbound — body/attachment handling", () => {
  it("returns silently when text is empty AND there are no attachments", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage({ text: "   " }),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).not.toHaveBeenCalled();
  });

  it("dispatches when text is empty but attachments are present", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage({
        text: "",
        attachments: [{ type: "image", url: "https://cdn/p.jpg" }],
      }),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    expect(dispatchInboundReplyWithBaseMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces inbound attachments through finalizeInboundContext as MediaUrls / MediaTypes", async () => {
    resolveDmGroupAccessWithCommandGateMock.mockReturnValue({
      decision: "allow",
      reason: "allowlist",
      commandAuthorized: false,
      shouldBlockControlCommand: false,
      effectiveGroupAllowFrom: [],
    });
    await handleMaxInbound({
      message: makeMessage({
        text: "see this",
        attachments: [
          { type: "image", url: "https://cdn/p.jpg" },
          { type: "video", url: "https://cdn/v.mp4" },
        ],
      }),
      account: makeAccount(),
      config: baseCfg,
      runtime: makeRuntimeEnv(),
    });
    const dispatched = dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0] as {
      ctxPayload: Record<string, unknown>;
    };
    expect(dispatched.ctxPayload.MediaUrl).toBe("https://cdn/p.jpg");
    expect(dispatched.ctxPayload.MediaUrls).toEqual(["https://cdn/p.jpg", "https://cdn/v.mp4"]);
    expect(dispatched.ctxPayload.MediaTypes).toEqual(["image", "video"]);
  });
});
