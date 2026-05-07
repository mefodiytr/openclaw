/**
 * Phase 5 unit tests for the pure cfg-mutation helper that backs
 * `maxMessengerGatewayAdapter.logoutAccount`. The helper is split out so the
 * test can lock the JSON shape without mocking `replaceConfigFile` (which is
 * a real fs writer).
 *
 * The marker-store side of logout is covered in `marker-store.test.ts`
 * (`scopes file paths per accountId so multi-account state cannot collide`
 * and `clear() removes the file and is idempotent on missing files`).
 */
import { describe, expect, it } from "vitest";
import { buildPostLogoutMaxConfig } from "../src/adapters/gateway.adapter.js";

describe("buildPostLogoutMaxConfig (default account)", () => {
  it("strips top-level token + tokenFile from the default account", () => {
    const result = buildPostLogoutMaxConfig(
      {
        channels: {
          "max-messenger": {
            token: "tk-default",
            tokenFile: "/tmp/x.token",
            dmPolicy: "pairing",
          },
        },
      },
      "default",
    );
    expect(result.changed).toBe(true);
    expect(result.cleared).toBe(true);
    const section = (result.nextCfg.channels as Record<string, Record<string, unknown>>)[
      "max-messenger"
    ];
    expect(section).toBeDefined();
    expect(section).not.toHaveProperty("token");
    expect(section).not.toHaveProperty("tokenFile");
    // Non-credential fields must survive logout.
    expect(section?.dmPolicy).toBe("pairing");
  });

  it("returns changed=false when the default account has no token to clear", () => {
    const result = buildPostLogoutMaxConfig(
      { channels: { "max-messenger": { dmPolicy: "pairing" } } },
      "default",
    );
    expect(result.changed).toBe(false);
    expect(result.cleared).toBe(false);
  });

  it("removes the channel section entirely when nothing remains after clear", () => {
    const result = buildPostLogoutMaxConfig(
      { channels: { "max-messenger": { token: "tk-default" } } },
      "default",
    );
    expect(result.changed).toBe(true);
    const channels = result.nextCfg.channels as Record<string, unknown> | undefined;
    expect(channels).toBeUndefined();
  });
});

describe("buildPostLogoutMaxConfig (named account)", () => {
  it("strips token + tokenFile from a single named account, keeps siblings", () => {
    const result = buildPostLogoutMaxConfig(
      {
        channels: {
          "max-messenger": {
            accounts: {
              support: { token: "tk-s", name: "Support" },
              ops: { token: "tk-o" },
            },
          },
        },
      },
      "support",
    );
    expect(result.changed).toBe(true);
    expect(result.cleared).toBe(true);
    const accounts = (result.nextCfg.channels as Record<string, Record<string, unknown>>)?.[
      "max-messenger"
    ]?.accounts as Record<string, Record<string, unknown>> | undefined;
    expect(accounts?.support).not.toHaveProperty("token");
    expect((accounts?.support as Record<string, unknown>)?.name).toBe("Support");
    expect((accounts?.ops as Record<string, unknown>)?.token).toBe("tk-o");
  });

  it("does not touch top-level token when clearing a named account", () => {
    const result = buildPostLogoutMaxConfig(
      {
        channels: {
          "max-messenger": {
            token: "tk-default",
            accounts: { support: { token: "tk-s" } },
          },
        },
      },
      "support",
    );
    const section = (result.nextCfg.channels as Record<string, Record<string, unknown>>)[
      "max-messenger"
    ];
    expect(section?.token).toBe("tk-default");
  });

  it("returns changed=false when the named account is unknown", () => {
    const result = buildPostLogoutMaxConfig(
      {
        channels: {
          "max-messenger": {
            accounts: { support: { token: "tk-s" } },
          },
        },
      },
      "unknown",
    );
    expect(result.changed).toBe(false);
  });

  it("preserves other channel sections (e.g. telegram) untouched", () => {
    const result = buildPostLogoutMaxConfig(
      {
        channels: {
          "max-messenger": { token: "tk-default" },
          telegram: { token: "tg-tk" } as never,
        },
      },
      "default",
    );
    const channels = result.nextCfg.channels as Record<string, Record<string, unknown>> | undefined;
    expect(channels).toBeDefined();
    expect(channels?.telegram).toEqual({ token: "tg-tk" });
    expect(channels?.["max-messenger"]).toBeUndefined();
  });
});
