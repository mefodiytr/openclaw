# @openclaw/max-messenger

OpenClaw bundled channel plugin for [MAX](https://max.ru/) — the Russian
messenger by VK.

Polling transport, multi-account, native pairing, agent reply pipeline,
inline keyboards, message_callback ack, and media attachments
(image / video / audio / file) are all wired up. Webhook transport (Phase 2)
remains deferred per
[`docs/max-plugin/plan.md`](../../docs/max-plugin/plan.md) §6.

## Status by phase

| Phase | Scope                                                 | Status   |
| ----- | ----------------------------------------------------- | -------- |
| 1A    | Scaffolding (manifests, schema, adapters)             | shipped  |
| 1B    | Polling supervisor + fake-MAX harness                 | shipped  |
| 1B.3  | Inbound dispatcher + agent reply pipeline             | shipped  |
| 2     | Webhook transport                                     | deferred |
| 3     | Inline keyboards + `message_callback` + group helpers | shipped  |
| 4     | Media attachments (send + receive)                    | shipped  |
| 5     | Multi-account hardening + standalone npm release      | this PR  |
| 6     | Test sweep (per-file unit + e2e)                      | next     |

## Configuring the channel

The channel is registered with id `max-messenger` (alias `max`). All config
keys live under `channels.max-messenger.*`.

### Single-account (default)

```jsonc
{
  "channels": {
    "max-messenger": {
      // Either reference a token file…
      "tokenFile": "~/.openclaw/credentials/max-messenger-bcai.token",
      // …or inline a SecretInput (env: ref or string).
      // "token": { "ref": "env:default:MAX_BOT_TOKEN" },

      "transport": "polling",
      "dmPolicy": "pairing",
      "allowFrom": ["12345678"],
    },
  },
}
```

The `MAX_BOT_TOKEN` env variable is honored as a fallback for the default
account only (mirrors `TELEGRAM_BOT_TOKEN`).

### Multi-account

Each account gets its own polling supervisor, dedup cache, and persisted
marker file (`~/.openclaw/state/channels/max-messenger/<accountId>.json`).
Top-level fields apply to every account unless overridden inside
`accounts.<id>`.

```jsonc
{
  "channels": {
    "max-messenger": {
      // Top-level defaults inherited by all accounts.
      "transport": "polling",
      "dmPolicy": "pairing",

      "defaultAccount": "support",
      "accounts": {
        "support": {
          "name": "BCAi support bot",
          "tokenFile": "~/.openclaw/credentials/max-support.token",
          "allowFrom": ["12345678", "87654321"],
        },
        "ops": {
          "name": "BCAi ops bot",
          "tokenFile": "~/.openclaw/credentials/max-ops.token",
          "allowFrom": ["55555555"],
        },
        "stale": {
          // Disabled accounts are skipped at gateway start without erroring.
          "enabled": false,
          "tokenFile": "~/.openclaw/credentials/max-old.token",
        },
      },
    },
  },
}
```

`openclaw channels logout max-messenger --account <id>` removes the persisted
token and the marker file (so a future start with a fresh token cannot replay
events the rotated bot saw).

## Secrets

`secret-contract.ts` registers two target paths so `openclaw secrets set` and
the doctor can find them:

- `channels.max-messenger.token` (default account)
- `channels.max-messenger.accounts.<id>.token` (per-account)

Use `tokenFile` for production; the SDK secret-file runtime rejects symlinks
and only reads files inside `~/.openclaw/credentials/`.

## References

- Implementation plan: [`docs/max-plugin/plan.md`](../../docs/max-plugin/plan.md)
- Project context: [`docs/max-plugin/CONTEXT.md`](../../docs/max-plugin/CONTEXT.md)
- Upstream sync runbook: [`docs/max-plugin/UPSTREAM-SYNC.md`](../../docs/max-plugin/UPSTREAM-SYNC.md)
