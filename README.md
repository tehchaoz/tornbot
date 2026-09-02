# Tornbot

A self-hosted Discord bot for [Torn City](https://www.torn.com). Built with
**Node.js** and **discord.js** (v14).

It keeps a live item price board in your server, watches markets and fires DM
alerts, tracks your faction (chains, wars, bank, armory, territory, activity),
helps you plan gains and happy jumps, finds easy targets, and even runs a
personal coach using a local LLM (Ollama) plus text-to-speech.

Everything is configured through `.env` — **no API keys are stored in code**.
Fork this repo and point it at your own bot and Torn API key.

> 💚 Enjoying this? Buy me a byte — [tehchaoz.github.io/tips](https://tehchaoz.github.io/tips/)

## Requirements

- Node.js **18+** (tested on 20/22)
- A Discord bot token
- A Torn API key (Full Access for most features)
- npm

Optional:
- A local [Ollama](https://ollama.com) server for the AI coach (`!coach`) and knowledge base
- A [Pocket TTS](https://github.com/Otto-7/pockettts) service for `!tts` / `!say`
- A local [Z-Image Turbo](https://github.com/ggml-org/stable-diffusion.cpp) GPU service (sd.cpp) for `!image`

## 1. Create the Discord bot

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** and copy the token.
3. Enable the **Message Content** intent (Server Members intent optional).
4. Invite the bot to your server with: **Manage Messages**, **Send Messages**,
   **Embed Links**, **Read Message History**, and **Connect**/**Speak** (for `!tts`/`!say`).

## 2. Get a Torn API key

Log into your Torn account → Preferences → API → create a key. For the full
faction feature set, use a key with **Full Access** (ideally held by your
faction's leader or a Full Access member).

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
| `MEMBER_INTRO_CHANNEL_ID` | `#member-intro` channel — the bot reads the timezone roster posted there and shows it in `!members` |
| `MEMBER_BOARD_CHANNEL_ID` | Channel for the pinned auto-updating `!members` board (defaults to `MEMBER_INTRO_CHANNEL_ID`) |
| `MEMBER_BOARD_INTERVAL` | Seconds between members-board refreshes (default 300; piggybacks the price cycle) |
| `PRICE_BOARD_INTERVAL` | Seconds between price-board Discord edits (default 40). The watchlist is spread across every per-user API key — each key pings its own slice once per ~40s, offset evenly |
| `PREFIX` | Command prefix (default `!`) |
| `TORN_ENCRYPTION_KEY` | 64-char hex key used to encrypt stored member data — set your own |
| `GUILD_ID` | Your Discord server ID (restricts rate-limited commands to one server) |

## 4. Run

```bash
npm install
npm start
```

### Run as a systemd service (Linux)

Edit `discord-bot.service` to match your install path, then:

```bash
sudo cp discord-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot
```

## Commands

Type `!help` in any channel the bot can see for the full list. The main commands:

### Accounts & personal
| Command | What it does |
|---|---|
| `!torn setup` | Link your Torn account to the bot (DM-guided) |
| `!torn status` | Show your linked Torn account |
| `!torn disconnect` | Unlink your Torn account |
| `!link <torn-id>` | Link your Torn account |
| `!torn [id]` | Player profile |
| `!verify` | Verify your Torn account is a faction member |
| `!bars` | Your energy / nerve / happy |
| `!gain` | Energy / nerve refill planner |
| `!gain on\|off` | DM you when energy/nerve fills, your education course completes, or your bank investment matures |
| `!pray on\|off` | Daily church prayer reminder (DM at a set hour; `!pray time <HH>` to change it) |
| `!timers` | View all active timers now (bars, cooldowns, course, bank investment) |
| `!levelpacer` | Time to next level |
| `!networth` | Networth breakdown |
| `!events` | Your recent in-game events + notifications |
| `!guide` | Your personalized next steps |
| `!guide on\|off` | Daily guide DM (10:00 local, same message updated) |

### Markets & economy
| Command | What it does |
|---|---|
| `!item <name\|id>` | Market prices |
| `!prices <item> [...]` | Scan multiple items |
| `!ph <item>` | Price history |
| `!watch <item>` / `!unwatch <item>` | Track prices |
| `!watchlist` | List tracked items |
| `!alert on\|off` | DM when a watched item hits a buy/sell signal |
| `!flips` | Buy-low / sell-high |
| `!arbitrage` | Bazaar → item-market flip opportunities |
| `!flipcalc <item> <qty> <buy> [sell]` | Profit calculator |
| `!junk` | List trash/vendor items (Other, Collectible, Unused) |
| `!stock <item>` | Torn City shop stock |
| `!travel [country]` | Abroad shop stock |
| `!abroad <item>` | Which countries have an item |
| `!points` | Points market prices |
| `!auctions <item>` | Auction house listings |
| `!museum` | Museum sets + point payouts |

### Faction & members
| Command | What it does |
|---|---|
| `!faction [id]` | Faction info |
| `!members` | Member status board (timezone + online status; also pinned as an auto-updating board) |
| `!tz <timezone>` | Set / update your timezone for `!members` |
| `!roster [name]` | Member list with level / location / last-active / days |
| `!activity [name]` | Faction member last-active tracking |
| `!baldr <name>` \| `!baldr list <level>` \| `!baldr scan <id>` | Search Baldr's full levelling list |
| `!known <name>` / `!known sync` | Everyone the bot has ever seen |
| `!finances` | Faction bank balance + member balances |
| `!bank balance` / `!bank req <amount> [reason]` | Faction vault |
| `!armory` | Faction armory inventory (weapons / armor / drugs) |
| `!territory` | Faction territory |
| `!wars` | Faction wars (ranked / raids / territory) |
| `!chainreport` | Current + recent chain stats |
| `!notify status` | Show faction alert monitors |

> **Member timezones:** `!members` shows a member's timezone when it's known. Timezones come from three
> places (highest priority first): an account's stored timezone (`!tz` / `!torn setup`), a matched entry in
> the `#member-intro` roster (parsed automatically — `MEMBER_INTRO_CHANNEL_ID`), or not at all. Torn's API
> does not expose member timezones, so the roster and `!tz` are the sources. Format lines in
> `#member-intro` like `Name, Location, UTC-5` or `DiscordName: TornName, Location, UTC+1`. Free-form
> inputs are normalized to `UTC±N (zone)` (e.g. "Eastern US" → `UTC-5/-4 (ET)`, "Sydney" → `UTC+10/+11 (AET)`).
>
> **Pinned members board:** `!members` is also posted as a pinned, auto-refreshing board in
> `MEMBER_BOARD_CHANNEL_ID` (defaults to the `#member-intro` channel). Each entry links to the member's
> Torn profile and shows an activity status icon. The key runs two lines — presence/timing on top,
> actions below:
> - 🟢 online · 🔵 idle <15m · ⚪ offline <2 days · 🟡 offline 2–6 days · 🔴 offline 7+ days
> - ✈ traveling · 🌍 abroad · 🏥 hospital · 🔒 jail · 💀 fallen
> The board refreshes on the same cycle as the price board
> (no extra API calls beyond `MEMBER_BOARD_INTERVAL`, default 300s).

### Progression & jobs
| Command | What it does |
|---|---|
| `!merits` / `!merits next` / `!merits earned` | Honor list + next-easiest to earn |
| `!perks` / `!perks all` | Faction perk tree (branch, level, respect cost, ability) |
| `!courses` / `!courses <name>` | Education courses, stats gained + duration |
| `!jobinfo` | Current job, points, ranks |
| `!job-apply` | Jobs you qualify for + interview |
| `!interview <job>` | Job interview answers |
| `!crime-route` | Best crime for your level / stats |
| `!levelpacer` | Time to next level |

### Helpers & fun
| Command | What it does |
|---|---|
| `!hj` / `!hj guide` | Happy jump helper (energy, happy, drug/booster cooldowns) |
| `!target` | Find easy kills (add / skip / scan / lists) |
| `!medals` / `!medals next` | Medals earned + next |
| `!calendar` | Upcoming game events |
| `!dirtybombs` | Recent dirty bomb events |
| `!bounties` | Bounty board |
| `!ocs` | Organized crime list + rewards |
| `!digest` | Force the daily market digest |
| `!tips` / `!tip <name>` | Rocket League training tips |
| `!teams @a @b ...` | Random team splitter (mentions 2+ players) |
| `!tts <text>` / `!tts voice <name>` | Text-to-speech (Pocket TTS) |
| `!say <text>` | Speak out loud in your voice channel |
| `!image <prompt>` | Generate a 1024x1024 photo on the local GPU (Z-Image Turbo) |
| `!ping` | Latency |

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
- Keep `.env` permissions restricted on a shared machine (`chmod 600 .env`).
- GitHub secret scanning + push protection are enabled on this repo.
