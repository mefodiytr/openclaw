# MAX Bot API — Reference for OpenClaw Plugin

Curated reference compiled for offline use by Claude Code in cloud sandbox (may not have reliable access to dev.max.ru). Source: dev.max.ru/docs as of April 2026, plus official SDK repos.

## Authorization & connection

- API base URL: `https://platform-api.max.ru`
- Old domain `botapi.max.ru` is deprecated (cutoff was October 2025)
- Token passed in HTTP header: `Authorization: <token>` (no `Bearer` prefix)
- Token delivery via query parameter is no longer supported
- Token is issued only after bot moderation completes (status "Ready to publish")
- Bot creation requires a verified Russian legal entity profile at dev.max.ru (individuals, sole proprietors, self-employed, non-residents are not allowed)

## Transports

A bot must use exactly one of:

1. **Long polling** — bot calls polling endpoint, receives batched updates
2. **Webhook** — MAX pushes updates to bot's HTTPS endpoint

Switching: if a webhook subscription exists, polling returns no events. Call `delete_webhook` before starting polling, or vice versa.

## Event types (incoming updates)

| Event              | When it fires                                      |
|--------------------|----------------------------------------------------|
| `bot_started`      | User taps "Start" button on bot card               |
| `message_created`  | Any incoming message (text, media, etc.)           |
| `message_callback` | User taps a CallbackButton in inline keyboard      |
| `message_edited`   | User edits a previously sent message               |
| `message_removed`  | User deletes a message                             |
| `bot_added`        | Bot added to a chat                                |
| `bot_removed`      | Bot removed from a chat                            |
| `user_added`       | New user joins a chat                              |
| `user_removed`     | User leaves a chat                                 |
| `chat_title_changed` | Group chat title changed                         |

Each event carries: `chat_id`, `user`, timestamp, and event-specific payload. For `message_created`, payload includes `message.body.text`, attachments, reply context.

## Outgoing operations

| Method              | Purpose                                         |
|---------------------|-------------------------------------------------|
| `send_message`      | Send text / media to a chat                     |
| `edit_message`      | Edit a previously sent message                  |
| `delete_message`    | Delete a message                                |
| `answer_callback`   | Respond to a callback button tap                |
| `set_my_commands`   | Register bot command hints                      |
| `upload_file`       | Upload media before attaching to message        |
| `get_chat`          | Fetch chat metadata                             |
| `get_members`       | List chat members                               |
| `set_webhook`       | Subscribe to webhook URL                        |
| `delete_webhook`    | Cancel webhook subscription                     |

## Keyboards & buttons

Inline keyboard attached to a message via `attachments`. Button types:

- `CallbackButton` — triggers `message_callback` event with payload
- `LinkButton` — opens URL
- `RequestContactButton` — asks user to share their contact
- `RequestGeoLocationButton` — asks user to share location
- `ChatButton` — opens a chat

## Attachments

Supported: image, video, audio, file, sticker, location, contact, share. Upload flow:

1. `POST /uploads` to get presigned upload URL for the type
2. Upload binary to that URL
3. Reference returned `token` in `attachments[]` of the outgoing message

## Differences from Telegram Bot API (porting reference)

| Aspect              | Telegram                | MAX                          |
|---------------------|-------------------------|------------------------------|
| Token in URL path   | Yes (`/bot<token>/...`) | No — header only             |
| Token in query      | Supported (legacy)      | Removed                      |
| Update endpoint     | `getUpdates`            | polling at platform-api      |
| Event model         | `Update` object with optional fields | Discrete event types |
| Inline keyboard     | `inline_keyboard` field | `attachments` with buttons   |
| File upload         | Direct multipart        | Two-step: get URL, upload, attach |
| Bot creation        | @BotFather, anyone      | Verified legal entity only   |
| Webhook setup       | `setWebhook`            | `set_webhook`                |

Mental model: "MAX is Telegram with extra steps and stricter access". The TypeScript SDK abstracts most differences.

## Official TypeScript SDK

Package: `@maxhub/max-bot-api` (npm)
Repo: https://github.com/max-messenger/max-bot-api-client-ts

Minimal usage:

```typescript
import { Bot } from '@maxhub/max-bot-api';

const bot = new Bot(process.env.BOT_TOKEN!);

bot.on('bot_started', (ctx) => ctx.reply('Hello!'));
bot.on('message_created', (ctx) => ctx.reply(ctx.message.body.text));

bot.start(); // starts long polling
```

For OpenClaw plugin we wrap this SDK rather than calling HTTP directly — SDK handles transport, retries, event normalization.

## Security notes

- Token is high-value credential — never log it, never commit it
- Webhook URL must be HTTPS with valid certificate
- Bot acts with full identity within authorized chats
- DM-from-strangers handling: MAX does not have a "first contact requires approval" flow at protocol level — must be implemented at OpenClaw layer (mirror `dmPolicy: "pairing"` pattern from Telegram/WhatsApp channels)

## Open questions

1. Exact response shape of polling endpoint (verify against current SDK source)
2. Rate limits — documented values? per-bot? per-chat?
3. Maximum message length — exact character limit
4. Voice message support — present in MAX, format unclear
5. WebApp / mini-app integration — out of scope for v1, may be relevant later

## Useful links

- Official docs: https://dev.max.ru/docs
- TS SDK: https://github.com/max-messenger/max-bot-api-client-ts
- Python SDK: https://github.com/max-messenger/max-botapi-python
- Go SDK: https://github.com/max-messenger/max-bot-api-client-go
- Bot moderation: https://dev.max.ru/docs/maxbusiness/connection
