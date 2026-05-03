# MAX Channel Plugin — Project Context

## Goal

Add support for the Russian messenger MAX (by VK) as a new channel plugin in OpenClaw, following the architecture of existing channel plugins like Telegram and Nextcloud Talk.

The plugin lives at `extensions/max/` and exposes a new `channels.max` configuration namespace.

## Why this fork exists

OpenClaw upstream supports 24+ messaging channels but does not include MAX, which is now the dominant Russian messaging platform (mandatory pre-install on Russian devices since September 2025). This fork adds that channel.

Long-term plan: contribute the plugin back to upstream as a PR if it reaches production quality, or publish as a standalone npm package.

## Owner

- Mikhail (BCControl / BS FM) — solo developer
- Bot will be registered under one of: ООО «Бизнес-Климат Контрол» or ООО «BS FM» (MAX requires a verified Russian legal entity)

## Architecture target

```
extensions/max/
├── package.json              # with openclaw.extensions + openclaw.channel
├── openclaw.plugin.json      # plugin metadata + JSON Schema for config
├── README.md
├── index.ts                  # entry: register(api)
└── src/
    ├── client.ts             # wrapper around @maxhub/max-bot-api
    ├── channel.ts            # implements OpenClaw channel interface
    ├── handlers.ts           # event handlers (message_created, etc.)
    └── types.ts              # local types
```

## Reference implementations to study

- `extensions/telegram/` — closest analog (similar Bot API model, polling/webhook)
- `extensions/nextcloud-talk/` — simple webhook-based channel
- `packages/plugin-sdk/` — SDK types and helpers
- `docs/tools/plugin.md` — plugin authoring docs

## API summary

See `docs/max-plugin/max-api-reference.md` for full API reference.

Key facts:
- API host: `https://platform-api.max.ru`
- Auth: HTTP header `Authorization: <token>` (NOT query param)
- Transports: Webhook OR Long Polling (one at a time)
- Official TypeScript SDK: `@maxhub/max-bot-api`
- Bot registration: only verified Russian legal entities at `dev.max.ru`

## Status

- [ ] Plan written (`docs/max-plugin/plan.md`)
- [ ] Plugin skeleton created (`extensions/max/`)
- [ ] MAX client wrapper implemented
- [ ] Channel interface implemented (polling MVP)
- [ ] Manual smoke test on BCAi with real bot token
- [ ] Webhook transport added
- [ ] Attachments + keyboards support
- [ ] Multi-account support
- [ ] Tests
- [ ] Upstream PR or npm publish

## Development workflow

- All design and coding happens via Claude Code on the web (mobile)
- Each task = one branch = one PR
- Local testing happens on BCAi server (192.168.200.184) by pulling main
- Bot token never enters the repo — lives only in BCAi `~/.openclaw/openclaw.json`
