/**
 * Phase 6 schema validation tests.
 *
 * Locks the four custom refinements in `config-schema.ts` so future schema
 * tweaks cannot regress them:
 *   - mutual exclusion of `token` and `tokenFile`
 *   - required token source (inline / file / env / per-account)
 *   - webhook transport requires `webhookUrl`
 *   - DM policy `open` requires explicit `allowFrom`
 *   - per-named-account token/tokenFile required (no env inheritance)
 *
 * Plus a few happy-path round-trips to keep us honest about the locked
 * default values from `docs/max-plugin/plan.md` §8 rows 6, 11–15.
 */
import { describe, expect, it } from "vitest";
import { MaxConfigSchema } from "../src/config-schema.js";
import { MAX_BOT_TOKEN_ENV } from "../src/constants.js";

const ENV = MAX_BOT_TOKEN_ENV;

function withoutEnv<T>(fn: () => T): T {
  const prev = process.env[ENV];
  delete process.env[ENV];
  try {
    return fn();
  } finally {
    if (prev !== undefined) {
      process.env[ENV] = prev;
    }
  }
}

function withEnv<T>(value: string, fn: () => T): T {
  const prev = process.env[ENV];
  process.env[ENV] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = prev;
    }
  }
}

describe("MaxConfigSchema (top-level)", () => {
  it("accepts an inline token with locked defaults applied", () => {
    const result = withoutEnv(() => MaxConfigSchema.safeParse({ token: "tk-default" }));
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.transport).toBe("polling");
    expect(result.data.dmPolicy).toBe("pairing");
    expect(result.data.groupPolicy).toBe("allowlist");
    expect(result.data.textChunkLimit).toBe(4000);
    expect(result.data.polling.timeoutSec).toBe(30);
    expect(result.data.polling.retryBackoffMs).toBe(1_000);
    expect(result.data.polling.maxBackoffMs).toBe(30_000);
    expect(result.data.polling.gracefulShutdownTimeoutMs).toBe(5_000);
    expect(result.data.polling.resumeFromLastEvent).toBe(true);
  });

  it("accepts a tokenFile alone", () => {
    const result = withoutEnv(() => MaxConfigSchema.safeParse({ tokenFile: "/tmp/secret.token" }));
    expect(result.success).toBe(true);
  });

  it("accepts MAX_BOT_TOKEN env as the only token source", () => {
    const result = withEnv("env-tk", () => MaxConfigSchema.safeParse({}));
    expect(result.success).toBe(true);
  });

  it("rejects when no token source is provided at all", () => {
    const result = withoutEnv(() => MaxConfigSchema.safeParse({}));
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.some((i) => /token required/iu.test(i.message))).toBe(true);
  });

  it("rejects when both token and tokenFile are present (mutually exclusive)", () => {
    const result = MaxConfigSchema.safeParse({
      token: "tk-default",
      tokenFile: "/tmp/x.token",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.some((i) => /either 'token' or 'tokenFile'/iu.test(i.message))).toBe(
      true,
    );
  });

  it("rejects webhook transport without webhookUrl", () => {
    const result = MaxConfigSchema.safeParse({
      token: "tk-default",
      transport: "webhook",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.some((i) => /webhookUrl is required/iu.test(i.message))).toBe(true);
  });

  it("accepts webhook transport with a webhookUrl", () => {
    const result = MaxConfigSchema.safeParse({
      token: "tk-default",
      transport: "webhook",
      webhookUrl: "https://example.com/max-webhook",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level keys (.strict())", () => {
    const result = MaxConfigSchema.safeParse({
      token: "tk",
      mystery: "ignored",
    });
    expect(result.success).toBe(false);
  });

  it("rejects polling.timeoutSec out of [1, 120]", () => {
    const tooLow = MaxConfigSchema.safeParse({ token: "tk", polling: { timeoutSec: 0 } });
    const tooHigh = MaxConfigSchema.safeParse({ token: "tk", polling: { timeoutSec: 121 } });
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  it("rejects an apiRoot that is not a URL", () => {
    const result = MaxConfigSchema.safeParse({ token: "tk", apiRoot: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects dmPolicy=open without `*` in allowFrom", () => {
    const result = MaxConfigSchema.safeParse({ token: "tk", dmPolicy: "open" });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.some((i) => /allowFrom/iu.test(i.message))).toBe(true);
  });

  it("accepts dmPolicy=open with allowFrom containing `*`", () => {
    const result = MaxConfigSchema.safeParse({
      token: "tk",
      dmPolicy: "open",
      allowFrom: ["*"],
    });
    expect(result.success).toBe(true);
  });
});

describe("MaxConfigSchema (named accounts)", () => {
  it("accepts named accounts each with their own token", () => {
    const result = withoutEnv(() =>
      MaxConfigSchema.safeParse({
        defaultAccount: "support",
        accounts: {
          support: { token: "tk-s" },
          ops: { tokenFile: "/tmp/o.token" },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts top-level missing token when at least one named account brings credentials", () => {
    const result = withoutEnv(() =>
      MaxConfigSchema.safeParse({
        accounts: { support: { token: "tk-s" } },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a named account without token or tokenFile (env fallback is default-only)", () => {
    const result = withEnv("env-tk", () =>
      MaxConfigSchema.safeParse({
        accounts: { support: {} },
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(
      result.error.issues.some((i) =>
        /each named account must declare 'token' or 'tokenFile'/iu.test(i.message),
      ),
    ).toBe(true);
  });

  it("rejects named account with both token and tokenFile (still mutually exclusive)", () => {
    const result = MaxConfigSchema.safeParse({
      accounts: { support: { token: "tk-s", tokenFile: "/tmp/s" } },
    });
    expect(result.success).toBe(false);
  });
});
