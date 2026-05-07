/**
 * Phase 5 unit tests for the multi-account resolution helpers in
 * `account-resolver.ts`. The skeleton was wired in Phase 1A/1B; these tests
 * lock the merge / default-selection / disabled-skip behavior so future
 * additions (Phase 6 doctor / status, native pairing migrations) cannot
 * regress the contract.
 */
import { describe, expect, it } from "vitest";
import {
  listMaxAccountIds,
  resolveDefaultMaxAccountId,
  resolveMaxAccount,
} from "../src/account-resolver.js";
import type { CoreConfig } from "../src/types.js";

const ENV_KEY = "MAX_BOT_TOKEN";

function withoutEnv<T>(fn: () => T): T {
  const prev = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  try {
    return fn();
  } finally {
    if (prev !== undefined) {
      process.env[ENV_KEY] = prev;
    }
  }
}

describe("listMaxAccountIds", () => {
  it("returns ['default'] when no accounts block is configured", () => {
    const cfg: CoreConfig = {
      channels: { "max-messenger": { token: "tk-default" } },
    };
    expect(listMaxAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns the configured account ids when accounts.* is set", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: {
            support: { tokenFile: "/tmp/s.token" },
            ops: { tokenFile: "/tmp/o.token" },
          },
        },
      },
    };
    expect(listMaxAccountIds(cfg).toSorted()).toEqual(["ops", "support"]);
  });
});

describe("resolveDefaultMaxAccountId", () => {
  it("returns 'default' when no accounts block exists", () => {
    const cfg: CoreConfig = { channels: { "max-messenger": { token: "tk-d" } } };
    expect(resolveDefaultMaxAccountId(cfg)).toBe("default");
  });

  it("returns the only configured account id when there is exactly one named account", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: { support: { tokenFile: "/tmp/s" } },
        },
      },
    };
    expect(resolveDefaultMaxAccountId(cfg)).toBe("support");
  });

  it("respects an explicit defaultAccount when multiple accounts exist", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          defaultAccount: "support",
          accounts: { support: { tokenFile: "/tmp/s" }, ops: { tokenFile: "/tmp/o" } },
        },
      },
    };
    expect(resolveDefaultMaxAccountId(cfg)).toBe("support");
  });
});

describe("resolveMaxAccount — single account", () => {
  it("resolves the default account from a top-level token", () => {
    const cfg: CoreConfig = {
      channels: { "max-messenger": { token: "tk-default" } },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: null }));
    expect(account.accountId).toBe("default");
    expect(account.token).toBe("tk-default");
    expect(account.tokenSource).toBe("config");
    expect(account.enabled).toBe(true);
    expect(account.apiRoot).toBe("https://platform-api.max.ru");
  });

  it("falls back to MAX_BOT_TOKEN env for the default account only", () => {
    const cfg: CoreConfig = { channels: { "max-messenger": {} } };
    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "tk-from-env";
    try {
      const account = resolveMaxAccount({ cfg, accountId: null });
      expect(account.token).toBe("tk-from-env");
      expect(account.tokenSource).toBe("env");
    } finally {
      if (prev === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = prev;
      }
    }
  });

  it("does NOT honor MAX_BOT_TOKEN env for non-default accounts", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: { support: {} },
        },
      },
    };
    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "tk-from-env";
    try {
      const account = resolveMaxAccount({ cfg, accountId: "support" });
      expect(account.token).toBe("");
      expect(account.tokenSource).toBe("none");
    } finally {
      if (prev === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = prev;
      }
    }
  });
});

describe("resolveMaxAccount — multi-account merge", () => {
  it("merges top-level config into per-account config (top-level apiRoot inherited)", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          apiRoot: "https://platform-api.max.example",
          dmPolicy: "open",
          accounts: { support: { token: "tk-s" } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "support" }));
    expect(account.apiRoot).toBe("https://platform-api.max.example");
    expect(account.config.dmPolicy).toBe("open");
    expect(account.token).toBe("tk-s");
  });

  it("per-account fields override top-level fields", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          dmPolicy: "open",
          accounts: { support: { token: "tk-s", dmPolicy: "allowlist" } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "support" }));
    expect(account.config.dmPolicy).toBe("allowlist");
  });

  it("propagates enabled: false from per-account block", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: { stale: { tokenFile: "/tmp/x", enabled: false } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "stale" }));
    expect(account.enabled).toBe(false);
  });

  it("propagates enabled: false from top-level when account does not override", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          enabled: false,
          accounts: { support: { token: "tk-s" } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "support" }));
    expect(account.enabled).toBe(false);
  });

  it("falls back to default account when the requested id has no credential", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          token: "tk-default",
          accounts: { unknown: {} },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "unknown" }));
    // The fallback resolver returns the requested id but with default's token.
    expect(account.token).toBe("tk-default");
  });

  it("normalizes account ids (case-insensitive)", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          accounts: { Support: { token: "tk-s" } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "support" }));
    expect(account.token).toBe("tk-s");
  });

  it("strips trailing slash from custom apiRoot", () => {
    const cfg: CoreConfig = {
      channels: {
        "max-messenger": {
          apiRoot: "https://platform-api.max.example/",
          accounts: { support: { token: "tk-s" } },
        },
      },
    };
    const account = withoutEnv(() => resolveMaxAccount({ cfg, accountId: "support" }));
    expect(account.apiRoot).toBe("https://platform-api.max.example");
  });
});
