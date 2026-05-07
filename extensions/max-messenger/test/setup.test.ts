/**
 * Phase 6 unit tests for the non-interactive setup adapter
 * (`maxMessengerSetupAdapter` from `setup-core.ts`). The interactive wizard
 * (`setup-surface.ts`) drives these helpers internally; locking the pure
 * adapter here keeps both paths from drifting.
 *
 * Live wizard exercises (prompter loops with stdin) are out of scope — they
 * sit on top of `WizardPrompter` from the SDK and are integration-tested at
 * the openclaw onboard CLI level.
 */
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { describe, expect, it } from "vitest";
import {
  clearMaxAccountFields,
  maxMessengerSetupAdapter,
  setMaxAccountConfig,
} from "../src/setup-core.js";
import type { CoreConfig } from "../src/types.js";

describe("setMaxAccountConfig", () => {
  it("writes default-account fields at the top level (no accounts.* nesting)", () => {
    const cfg: CoreConfig = {};
    const next = setMaxAccountConfig(cfg, DEFAULT_ACCOUNT_ID, { token: "tk-default" });
    const section = next.channels?.["max-messenger"];
    expect(section?.token).toBe("tk-default");
    expect(section?.accounts).toBeUndefined();
  });

  it("writes a named account under accounts.<id>", () => {
    const cfg: CoreConfig = {};
    const next = setMaxAccountConfig(cfg, "support", { token: "tk-s", name: "Support" });
    const section = next.channels?.["max-messenger"];
    expect(section?.accounts?.support).toMatchObject({ token: "tk-s", name: "Support" });
  });

  it("merges into an existing named account (does not replace siblings)", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: {
            support: { token: "tk-old" },
            ops: { token: "tk-o" },
          },
        },
      },
    };
    const next = setMaxAccountConfig(cfg, "support", { name: "Support v2" });
    expect(next.channels?.["max-messenger"]?.accounts?.support).toMatchObject({
      name: "Support v2",
    });
    expect(next.channels?.["max-messenger"]?.accounts?.ops?.token).toBe("tk-o");
  });
});

describe("clearMaxAccountFields", () => {
  it("clears top-level fields for the default account", () => {
    const cfg: CoreConfig = {
      channels: { "max-messenger": { token: "tk-d", tokenFile: "/tmp/x" } },
    };
    const next = clearMaxAccountFields(cfg, DEFAULT_ACCOUNT_ID, ["token", "tokenFile"]);
    const section = next.channels?.["max-messenger"];
    expect(section).not.toHaveProperty("token");
    expect(section).not.toHaveProperty("tokenFile");
  });

  it("clears fields under accounts.<id> for a named account", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: { support: { token: "tk-s", name: "Support" } },
        },
      },
    };
    const next = clearMaxAccountFields(cfg, "support", ["token"]);
    expect(next.channels?.["max-messenger"]?.accounts?.support).toEqual({ name: "Support" });
  });

  it("is a no-op when the channel section is absent", () => {
    const cfg: CoreConfig = {};
    expect(clearMaxAccountFields(cfg, DEFAULT_ACCOUNT_ID, ["token"])).toBe(cfg);
  });

  it("is a no-op when the named account is absent", () => {
    const cfg: CoreConfig = {
      channels: { "max-messenger": { accounts: { ops: { token: "tk-o" } } } },
    };
    expect(clearMaxAccountFields(cfg, "support", ["token"])).toBe(cfg);
  });
});

describe("maxMessengerSetupAdapter.validateInput", () => {
  it("rejects an input with no useEnv / token / tokenFile", () => {
    const validate = maxMessengerSetupAdapter.validateInput as (params: {
      accountId: string;
      input: Record<string, unknown>;
    }) => string | null;
    const error = validate({ accountId: DEFAULT_ACCOUNT_ID, input: {} });
    expect(error).toMatch(/MAX requires bot token or --token-file/iu);
  });

  it("accepts useEnv: true for the default account", () => {
    const validate = maxMessengerSetupAdapter.validateInput as (params: {
      accountId: string;
      input: Record<string, unknown>;
    }) => string | null;
    expect(validate({ accountId: DEFAULT_ACCOUNT_ID, input: { useEnv: true } })).toBeNull();
  });

  it("rejects useEnv: true for a named (non-default) account", () => {
    const validate = maxMessengerSetupAdapter.validateInput as (params: {
      accountId: string;
      input: Record<string, unknown>;
    }) => string | null;
    const error = validate({ accountId: "support", input: { useEnv: true } });
    expect(error).toMatch(/MAX_BOT_TOKEN can only be used for the default account/iu);
  });

  it("accepts an explicit tokenFile", () => {
    const validate = maxMessengerSetupAdapter.validateInput as (params: {
      accountId: string;
      input: Record<string, unknown>;
    }) => string | null;
    expect(validate({ accountId: "support", input: { tokenFile: "/tmp/s.token" } })).toBeNull();
  });
});

describe("maxMessengerSetupAdapter.applyAccountConfig", () => {
  it("writes a token for the default account from a setup input", () => {
    const apply = maxMessengerSetupAdapter.applyAccountConfig as (params: {
      cfg: unknown;
      accountId: string;
      input: Record<string, unknown>;
    }) => CoreConfig;
    const next = apply({
      cfg: {} as CoreConfig,
      accountId: DEFAULT_ACCOUNT_ID,
      input: { token: "tk-default" },
    });
    expect(next.channels?.["max-messenger"]?.token).toBe("tk-default");
  });

  it("writes a tokenFile for a named account from a setup input", () => {
    const apply = maxMessengerSetupAdapter.applyAccountConfig as (params: {
      cfg: unknown;
      accountId: string;
      input: Record<string, unknown>;
    }) => CoreConfig;
    const next = apply({
      cfg: {} as CoreConfig,
      accountId: "support",
      input: { tokenFile: "/tmp/s.token", name: "Support" },
    });
    expect(next.channels?.["max-messenger"]?.accounts?.support).toMatchObject({
      tokenFile: "/tmp/s.token",
      name: "Support",
    });
  });

  it("clears stored token and tokenFile when useEnv: true is supplied for the default account", () => {
    const apply = maxMessengerSetupAdapter.applyAccountConfig as (params: {
      cfg: unknown;
      accountId: string;
      input: Record<string, unknown>;
    }) => CoreConfig;
    const next = apply({
      cfg: {
        channels: {
          "max-messenger": { token: "tk-old", tokenFile: "/tmp/x.token" },
        },
      } as CoreConfig,
      accountId: DEFAULT_ACCOUNT_ID,
      input: { useEnv: true },
    });
    const section = next.channels?.["max-messenger"];
    expect(section).not.toHaveProperty("token");
    expect(section).not.toHaveProperty("tokenFile");
  });
});
