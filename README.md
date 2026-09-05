# Tornbot

A self-hosted Discord bot for [Torn City](https://www.torn.com). Built with
**Node.js** and **discord.js** (v14).

It keeps a live item price board in your server, watches markets and fires DM
alerts, tracks your faction (chains, wars, bank, armory, territory, activity),
helps you plan gains and happy jumps, and finds easy targets.

Everything is configured through `.env` — **no API keys are stored in code**.
Fork this repo and point it at your own bot and Torn API key.

> 💚 Enjoying this? Buy me a byte — [tehchaoz.github.io/tips](https://tehchaoz.github.io/tips/)

## Requirements

- Node.js **18+** (tested on 20/22) — [nodejs.org](https://nodejs.org)
- A Torn City account
- npm (comes with Node.js)

Optional:
- A local [Ollama](https://ollama.com) server for the AI coach (`!coach`) and knowledge base

## Quick start (one command)

Clone this repo, then run the setup wizard — it does everything for you
(no prior install needed):

```bash
node setup.js
```

The wizard walks you through creating a Discord bot and Torn API key, then
auto-writes your `.env`, generates a secure encryption key, installs
dependencies, and prints a ready-to-click invite link. No coding needed.

When it finishes you can start the bot with:

```bash
npm start
```

The rest of this README explains each step manually, in case you prefer to
configure things yourself or want extra control.

## 1. Create the Discord bot

### 1a. Create the application and get the token

1. Go to https://discord.com/developers/applications → **New Application**.
2. Give it a name and click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Reset Token** → **Yes, do it!**, then **Copy**. Paste that token into
   your `.env` as `DISCORD_TOKEN`. Keep it secret — never commit it.

### 1b. Turn on the privileged intents (required — the bot will not work without these)

Still on the **Bot** page, scroll to **Privileged Gateway Intents** and turn ON:

| Intent | Why it's required |
|---|---|
| **Message Content Intent** | Lets the bot *read* message content, so it can see `!commands` **and DM replies**. Without it, nothing responds. |
| **Server Members Intent** | Lets the bot see when a **new member joins** (used to greet them with `!torn setup`). Without it, the welcome message and member roster break. |

> Presence Intent is optional — the bot doesn't use it.

Then click **Save Changes**.

### 1c. Invite the bot to your server (OAuth2 URL Generator)

1. In the left sidebar, click **OAuth2** → **URL Generator**.
2. Under **Scopes**, tick **`bot`** (and **`applications.commands`** if you use
   slash commands, otherwise skip it).
3. Under **Bot Permissions**, tick at minimum:
   - **View Channels**
   - **Send Messages**
   - **Send Messages in Threads**
   - **Read Message History**
   - **Embed Links**
   - **Attach Files**
   - **Manage Messages**
4. Copy the generated **URL** at the bottom and open it in a browser, then pick
   the server you want to add the bot to and authorize.

> The bot needs **Read Message History** to see messages, **Direct Messages**
> work out of the box for bots (no permission toggle, that's why DM onboarding
> works), and **Manage Messages** lets it clean up its own messages (e.g. the
> `!help` auto-delete).

> **Windows users:** on a fresh Node LTS install everything installs as-is.
> If `npm install` reports a build error for `better-sqlite3`, install
> [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
> (Workload: "Desktop development with C++"), then run `npm install` again.

## 2. Get a Torn API key

Log into your Torn account → Preferences → API → create a key. For the full
faction feature set, use a key with **Full Access** (ideally held by your
faction's leader or a Full Access member).

### Optional: FFScouter target finder

`!target` and `!target ff` can pull pre-filtered attack targets from
[FFScouter](https://ffscouter.com) (fair fight 2–3, inactive 14d+). Each
member's own linked key is used when it is registered with FFScouter (so fair
fight is relative to their own stats); unregistered members fall back to
`FFSCOUTER_API_KEY` if set, otherwise the bot owner key. Unregistered or
rate-limited keys are skipped silently, so nothing breaks if you never set
this up.

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
| `TORN_API_KEY_2` | Optional second Torn API key (rate limits / extra scope) |
| `FFSCOUTER_API_KEY` | Optional — a Torn key registered at ffscouter.com; fallback for `!target ff` when a member hasn't registered their own |
| `FACTION_ID` | Your faction's numeric ID (required for faction features) |
| `BOARD_CHANNEL_IDS` | Channel(s) for the price board, comma-separated |
| `CHAIN_CHANNEL_ID` | Channel for chain-monitoring alerts |
| `MEMBER_INTRO_CHANNEL_ID` | `#member-intro` channel — the bot reads the timezone roster posted there and shows it in `!members` |
| `MEMBER_BOARD_CHANNEL_ID` | Channel for the pinned auto-updating `!members` board (defaults to `MEMBER_INTRO_CHANNEL_ID`) |
| `MEMBER_BOARD_INTERVAL` | Seconds between members-board refreshes (default 300; piggybacks the price cycle) |
| `PRICE_BOARD_INTERVAL` | Seconds between price-board Discord edits (default 10). The watchlist is spread across every per-user Torn account — each account pings its own slice once per cycle, offset evenly |
| `PRICE_POLL_INTERVAL` | Seconds between each account's Torn poll of its watchlist slice (default 10). Lower = fresher prices but closer to the 100 req/min-per-account limit |
| `PREFIX` | Command prefix (default `!`) |
| `TORN_ENCRYPTION_KEY` | 64-char hex key used to encrypt stored member data — set your own |
| `GUILD_ID` | Your Discord server ID (restricts rate-limited commands to one server) |
| `WELCOME_CHANNEL_ID` | Channel to post new-member welcome messages (the bot DMs newcomers if blank) |
| `PERMISSIONS_PATH` | Path to the tier-assignment JSON (defaults to `./permissions.json`; edit it or use `!tier`/`!promote`/`!demote` in Discord) |

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
| `!chain <date> <time>` / `!chain join` / `!chain leave` / `!chain list` / `!chain cancel` | Plan and coordinate faction chain attacks with Xanax reminders |
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

### Chain attack coordinator
Officers plan faction chains, members sign up, and the bot schedules each
member's four Xanax before the chain starts — timing against their live
drug cooldown from the Torn API.

| Command | What it does |
|---|---|
| `!chain <date> <time>` | Schedule a chain. Time is Torn City Time (UTC), e.g. `!chain 09/04/26 1900`, `!chain 09/04 1900`, or bare `!chain 1900` (next time today) |
| `!chain join` | Sign up for the scheduled chain; the bot reads your drug cooldown and builds your Xanax plan |
| `!chain leave` | Drop out of the chain |
| `!chain list` (officer) | Who signed up + each person's scheduled Xanax doses |
| `!chain cancel` (officer) | Cancel the chain and clear all reminders |

Reminders are posted to `CHAIN_CHANNEL_ID` with an @mention for each dose.
If the bot restarts, pending reminders resume from the SQLite store. Each
member's cooldown is read via their **own** Torn API key, so the added
polls stay within the 100 req/min-per-account limit.

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
| `!target` | Find easy kills (add / skip / scan / lists / **ff** — FFScouter targets if enabled) |
| `!medals` / `!medals next` | Medals earned + next |
| `!calendar` | Upcoming game events |
| `!dirtybombs` | Recent dirty bomb events |
| `!bounties` | Bounty board |
| `!ocs` | Organized crime list + rewards |
| `!digest` | Force the daily market digest |
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
