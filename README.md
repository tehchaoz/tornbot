# Tornbot

A self-hosted Discord bot for [Torn](https://www.torn.com) city management. Built with
**Node.js** and **discord.js** (v14). Features a live item price board, faction
monitoring (chains, wars, bank, armory), personal stats, happy-jump alerts, a
targeting/attacks tool, an optional local-LLM personal coach, and TTS.

All configuration is environment-driven (`.env`) — no API keys are stored in code.
Fork this repo and configure it for your own faction and Discord server.

## Requirements

- Node.js **18+** (tested on 20/22)
- A Discord bot token
- A Torn API key (Full Access for most features)
- npm

Optional extras:
- A local [Ollama](https://ollama.com) server for the AI coach (`!coach`) and knowledge base
- A [Pocket TTS](https://github.com/Otto-7/pockettts) service for `!tts` / `!say`

## 1. Create the Discord bot

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** and copy the token.
3. Enable the **Message Content intent** (Server Members intent optional).
4. Invite the bot to your server with the **Manage Messages**, **Send Messages**,
   **Embed Links**, **Read Message History**, and **Connect**/**Speak** (for TTS) permissions.

## 2. Get a Torn API key

1. Log into your Torn account → Preferences → API and create a key.
2. For full faction features, use a key owned by someone with **Full Access**
   (ideally from your faction's leader or a Full Access member).

## 3. Configure

```bash
cp .env.example .env
# edit .env and fill in your token, keys, faction ID, and channel IDs
```

Key variables:

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Your bot token (required) |
| `TORN_API_KEY` | Your Torn API key (required) |
| `FACTION_ID` | Your faction's numeric ID (required for faction features) |
| `BOARD_CHANNEL_IDS` | Channel(s) for the price board, comma-separated |
| `CHAIN_CHANNEL_ID` | Channel for chain-monitoring alerts |
| `PREFIX` | Command prefix (default `!`) |
| `TORN_ENCRYPTION_KEY` | 64-char hex key used to encrypt stored member data — set your own |
| `GUILD_ID` | Your Discord server ID (restricts rate-limited commands to one server) |

## 4. Run

```bash
npm install
npm start
```

### Run as a systemd service (Linux)

Edit `discord-bot.service` to point at your install path, then:

```bash
sudo cp discord-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot
```

## Commands

Type `!help` in a channel the bot can see for a full list. Highlights:

- `!board` / price-board refresh · `!flips` · `!arbitrage` · `!junk`
- `!baldr` (full faction member list) · `!roster` · `!target` (attack targeting)
- `!finances` · `!chainreport` · `!armory` · `!wars`
- `!merits` · `!perks` · `!courses` · `!networth` · `!medals`
- `!happy` / happy-jump alerts · `!notify`
- `!tts <text>` / `!say <text>` (if a TTS service is configured)
- `!coach` (if Ollama is configured)

## Project layout

```
bot.js                  Main entry point, command dispatch, price board, monitors
commands/               One file per feature area
services/               API wrapper, accounts storage, knowledge base, reply helpers
.env.example            Template configuration (copy to .env)
discord-bot.service     systemd unit example
```

## Security notes

- Your real API keys live **only** in `.env`, which is gitignored.
- The bot encrypts stored member/Torn credentials with `TORN_ENCRYPTION_KEY`.
- If you run this publicly or from a shared machine, keep the `.env` file
  permissions restricted (`chmod 600 .env`).
