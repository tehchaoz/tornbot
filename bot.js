const { Client, GatewayIntentBits, Events } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const accountStore = require('./services/account-store');
const timezoneRoster = require('./services/timezone-roster');
const tzNormalize = require('./services/tz-normalize');
const tornApi = require('./services/torn-api');
const setupCommands = require('./commands/setup');
const personalCommands = require('./commands/personal');
const targetCommands = require('./commands/target');
const baldrCommands = require('./commands/baldr');
const junkCommands = require('./commands/junk');
const happyjumpCommands = require('./commands/happyjump');
const meritsCommands = require('./commands/merits');
const coursesCommands = require('./commands/courses');
const perksCommands = require('./commands/perks');
const rosterCommands = require('./commands/roster');
const factionStatsCommands = require('./commands/faction-stats');
const economyCommands = require('./commands/economy');
const personalStatsCommands = require('./commands/personal-stats');
const eventsInfoCommands = require('./commands/events-info');
const knownCommands = require('./commands/known');
const ttsCommands = require('./commands/tts');
const imageCommands = require('./commands/image');
const knownPlayers = require('./services/known-players');
const { wrapMessage, dmChunks, chunkText } = require('./services/reply');
const { createFactionFeatures } = require('./commands/faction-features');

dotenv.config();

const PREFIX = process.env.PREFIX || '!';
const TORN_API_KEY = process.env.TORN_API_KEY || '';
const TORN_API_KEY_2 = process.env.TORN_API_KEY_2 || '';
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || '';
function isOwnerDiscord(id) {
  return !!OWNER_DISCORD_ID && String(id) === String(OWNER_DISCORD_ID);
}
const FACTION_ID = process.env.FACTION_ID || '';
const CHAIN_CHANNEL_ID = process.env.CHAIN_CHANNEL_ID || '';
const BOARD_CHANNEL_IDS = process.env.BOARD_CHANNEL_IDS || CHAIN_CHANNEL_ID;
const WAR_CHANNEL_ID = process.env.WAR_CHANNEL_ID || '';
const DIGEST_CHANNEL_ID = process.env.DIGEST_CHANNEL_ID || '';
const TORN_ENCRYPTION_KEY = process.env.TORN_ENCRYPTION_KEY || '';
const DATABASE_PATH = process.env.DATABASE_PATH || '';

const RETALIATION_CHANNEL_ID = process.env.RETALIATION_CHANNEL_ID || WAR_CHANNEL_ID || '';
const OC_CHANNEL_ID = process.env.OC_CHANNEL_ID || CHAIN_CHANNEL_ID || '';
const BANK_CHANNEL_ID = process.env.BANK_CHANNEL_ID || CHAIN_CHANNEL_ID || '';
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || CHAIN_CHANNEL_ID || '';

let factionFeatures = null;

const COUNTRY_CODES = {
  mexico: 'mex', mex: 'mex',
  cayman: 'cay', 'cayman islands': 'cay', cay: 'cay',
  canada: 'can', can: 'can',
  hawaii: 'haw', haw: 'haw',
  uk: 'uni', 'united kingdom': 'uni', uni: 'uni',
  argentina: 'arg', arg: 'arg',
  switzerland: 'swi', swi: 'swi',
  japan: 'jap', jap: 'jap',
  china: 'chi', chi: 'chi',
  uae: 'uae', 'united arab emirates': 'uae',
  'south africa': 'sou', sou: 'sou', southafrica: 'sou',
};
const COUNTRY_NAMES = {
  mex: 'Mexico', cay: 'Cayman Islands', can: 'Canada', haw: 'Hawaii', uni: 'United Kingdom',
  arg: 'Argentina', swi: 'Switzerland', jap: 'Japan', chi: 'China', uae: 'UAE', sou: 'South Africa',
};

const INTERVIEW = {
  army: {
    name: 'Army',
    qa: [
      ['\u201cBrain bucket\u201d refers to what?', 'A helmet'],
      ['When did World War 2 start?', '1939'],
      ['\u201cThis is my rifle, this is my gun, this is for ___ and this is for ___\u201d', 'Fighting, Fun'],
      ['A \u201cjarhead\u201d refers to what?', 'United States Marine'],
      ['What does USMC stand for?', 'United States Marine Corps'],
      ['Which is the higher rank in the US Army?', 'General'],
      ['What does RPG stand for?', 'Rocket propelled grenade'],
      ['Which is NOT a rank in the US army?', 'Admiral'],
      ['Which country has America NEVER been at war with?', 'France'],
    ],
  },
  grocer: {
    name: 'Grocer',
    qa: [
      ['Which fruit does not grow on a tree?', 'Strawberries'],
      ['Which of these is not a stone fruit?', 'Pear'],
      ['A customer cannot find what they are looking for. What do you do?', "Tell them to leave their name and number, and we'll order it in for them"],
      ['Which fruit cannot be rhymed with any other word?', 'Orange'],
      ['When is the customer right?', 'The customer is always right'],
      ['A customer has stolen produce and is walking out. What do you do?', 'Call the police immediately'],
      ['A customer hands you money for their products. What do you do?', 'Place the money in the till and give them their change'],
      ['Produce is starting to rot. What do you do?', 'Immediately dispose of the rotting produce'],
      ['What fruit is frequently mistaken as a vegetable?', 'Tomato'],
    ],
  },
  casino: {
    name: 'Casino',
    qa: [
      ['The common currency used in casinos is known as?', 'Chips'],
      ['Nickname for the overhead camera monitoring players and dealers?', 'Eye in the Sky'],
      ['Which of these is a type of poker game?', "Texas Hold'em"],
      ['In blackjack, the lowest number the dealer does NOT hit on?', '17'],
      ['In poker, which is the better hand?', 'Royal Flush'],
      ['Which hand would NOT beat a pair of fives?', 'A pair of twos'],
      ['Which of these is not usually found in a casino?', 'A clock'],
      ['Which odds give a bigger payout?', '50/1'],
      ['What does \u201ccash out\u201d mean?', 'Exchange credit back to cash and leave'],
    ],
  },
  law: {
    name: 'Law',
    qa: [
      ['In court, what is the purpose of the jury?', 'To give a true verdict based on evidence presented'],
      ['Highest court a case can escalate to in the US?', 'Supreme Court'],
      ['Malicious act to intentionally damage property is called?', 'Vandalism'],
      ['How do you start a civil action?', 'File a complaint with the court'],
      ['What is a plea bargain?', 'An incentive for a defendant to plead guilty'],
      ['A convicted person hiding from the law is known as?', 'Fugitive from Justice'],
      ['A breach of your right, or a civil wrong against you, is called?', 'Tort'],
      ['Usual basis for filing a civil lawsuit?', 'Negligence, intentional acts, or breach of contract'],
      ['What crime never occurs during a full moon?', 'Murder'],
    ],
  },
  medical: {
    name: 'Medical',
    qa: [
      ['Patient has an object embedded in their arm, penetrating an artery. Treatment?', 'Apply a dressing around the object and get them to a hospital'],
      ['How much blood is in the average adult?', '5 liters'],
      ['Tachycardia refers to what?', 'An accelerated heart rate'],
      ['What is the femur?', 'Thigh bone'],
      ['Someone is choking, clutching their throat. What do you do?', 'Perform the Heimlich maneuver'],
      ['How many bones does an adult human have?', '206'],
      ['A DRE examination places a lubricated finger where?', 'Rectum'],
      ['Normal core body temperature?', '37.0 degrees Celsius'],
      ['What does \u201cSoldier\u2019s disease\u201d stand for?', 'Morphine addiction'],
    ],
  },
  education: {
    name: 'Education',
    qa: [
      ['If someone is deemed \u201cilliterate\u201d, what does it mean?', 'They cannot read or write'],
      ['\u201cWe were walking down the road and ___ was a loud noise.\u201d', 'There'],
      ['A student is bullying another pupil. What do you do?', 'Put the bully in detention and send a letter home'],
      ['An adverb is what?', "A word describing an action, such as 'beautifully'"],
      ['X + 15 = 27. What is X?', '12'],
      ['Complete: \u201cQuoth the raven ___\u201d', 'Never more'],
      ['Correct spelling (collection of varied things)?', 'Miscellaneous'],
      ['A girl cut her knee in the playcourt. What do you do?', 'Send her to the school nurse'],
      ['What does SAT stand for?', 'Scholastic Aptitude Test'],
    ],
  },
};


const TORN_GUILD_ID = process.env.GUILD_ID || '';


const TORN_COMMANDS = ['torn', 'faction', 'members', 'territory', 'item', 'prices', 'ph', 'pricehistory', 'watch', 'unwatch', 'watchlist', 'flips', 'stock', 'travel', 'abroad', 'bars', 'link', 'guide', 'interview', 'gain', 'timers', 'crime', 'crimeroute', 'crime-route', 'flipcalc', 'levelpacer', 'pacer', 'job', 'jobapply', 'job-apply', 'digest', 'alert', 'verify', 'bank', 'notify', 'baldr', 'junk', 'hj', 'happyjump', 'merits', 'perks', 'courses', 'activity', 'roster', 'finances',   'chainreport', 'armory', 'wars', 'arbitrage', 'points', 'auctions', 'museum', 'networth', 'medals', 'jobinfo', 'events', 'calendar', 'dirtybombs', 'bounties', 'ocs', 'known', 'tts', 'say', 'tz', 'image'];

const TORN_HELP =
  '**Torn**\n' +
  '`!abroad <item>` — which countries have an item\n' +
  '`!activity [name]` — faction member last-active tracking\n' +
  '`!alert on|off` — DM me when watched items hit a buy/sell signal\n' +
  '`!arbitrage` — bazaar → item-market flip opportunities\n' +
  '`!armory` — faction armory inventory (weapons/armor/drugs)\n' +
  '`!auctions <item>` — auction house listings\n' +
  '`!baldr <name>` / `!baldr list <level>` / `!baldr scan <id>` — search Baldr\'s full levelling list\n' +
  '`!bank balance` / `!bank req <amount> [reason]` — faction vault\n' +
  '`!bars` — your energy/nerve/happy\n' +
  '`!bounties` — bounty board\n' +
  '`!calendar` — upcoming game events\n' +
  '`!chainreport` — current + recent chain stats\n' +
  '`!courses` / `!courses <name>` — education courses, stats gained + duration\n' +
  '`!crime-route` — best crime for your level/stats\n' +
  '`!digest` — force the daily market digest\n' +
  '`!dirtybombs` — recent dirty bomb events\n' +
  '`!events` — your recent in-game events + notifications\n' +
  '`!faction [id]` — faction info\n' +
  '`!finances` — faction bank balance + member balances\n' +
  '`!flipcalc <item> <qty> <buy> [sell]` — profit calculator\n' +
  '`!flips` — buy-low/sell-high\n' +
  '`!gain` — energy/nerve refill planner\n' +
  '`!gain on|off` — DM when energy/nerve fills, a course completes, or a bank investment matures\n' +
  '`!timers` — view your active timers now (bars, cooldowns, course, bank investment)\n' +
  '`!guide` — your personalized next steps\n' +
  '`!guide on|off` — daily guide DM (10:00 local, same message updated)\n' +
  '`!hj` / `!hj guide` — happy jump helper (energy, happy, drug/booster cooldowns)\n' +
  '`!interview <job>` — job interview answers\n' +
  '`!item <name|id>` — market prices\n' +
  '`!job-apply` — jobs you qualify for + interview\n' +
  '`!jobinfo` — current job, points, ranks\n' +
  '`!junk` — list trash/vendor items (no use: Other, Collectible, Unused)\n' +
  '`!known <name>` / `!known sync` — everyone the bot has ever seen\n' +
  '`!levelpacer` — time to next level\n' +
  '`!link <torn-id>` — link your Torn account\n' +
  '`!medals` / `!medals next` — medals earned + next\n' +
  '`!members` — member status board (with timezone where known)\n' +
  '`!tz <location>` — set/update your timezone or location for `!members`\n'+
  '`!merits` / `!merits next` / `!merits earned` — honor list + next-easiest to earn\n' +
  '`!museum` — museum sets + point payouts\n' +
  '`!networth` — your networth breakdown\n' +
  '`!notify status` — show faction alert monitors\n' +
  '`!ocs` — organized crime list + rewards\n' +
  '`!perks` / `!perks all` — faction perk tree (branch, level, respect cost, ability)\n' +
  '`!ph <item>` — price history\n' +
  '`!ping` — latency\n' +
  '`!points` — points market prices\n' +
  '`!prices <item> [...]` — scan multiple items\n' +
  '`!roster [name]` — member list with level/location/last-active/days\n' +
  '`!stock <item>` — Torn City shop stock\n' +
  '`!target` — find easy kills (add/skip/scan/lists)\n' +
  '`!territory` — faction territory\n' +
  '`!torn [id]` — player profile\n' +
  '`!travel [country]` — abroad shop stock\n' +
  '`!tts <text>` / `!tts voice <name>` — text-to-speech (Pocket TTS)\n' +
  '`!say <text>` — speak out loud in your voice channel\n' +
  '`!image <prompt>` — generate a 1024x1024 photo on the local GPU (Z-Image Turbo)\n' +
  '`!verify` — verify your Torn account is a faction member\n' +
  '`!wars` — faction wars (ranked/raids/territory)\n' +
  '`!watch <item>` / `!unwatch <item>` — track prices\n' +
  '`!watchlist` — list tracked items';

async function handleHelp(message) {
  await message.reply(TORN_HELP);
}
const PRICES_FILE = '/opt/discord-bot/prices.json';
const DEFAULT_WATCH = ['Xanax', 'Morphine', 'First Aid Kit', 'Small First Aid Kit', 'Ecstasy', 'Bag of Candy Kisses', 'Lollipop', 'Six-Pack of Energy Drink', 'Bottle of Beer', 'LSD', 'Speed', 'PCP', 'Ketamine', 'Shrooms', 'Opium', 'Vicodin', 'Dumbbells', 'Sheep Plushie', 'Teddy Bear Plushie', 'Donator Pack'];
const HISTORY_LIMIT = 2160;
const ALERT_MIN_HISTORY = 48;
const SELL_FEE = 0.05;
const SIGNAL_COOLDOWN = 30 * 60;
const SELL_STALE_POLLS = 30;
const STALE_SECONDS = 240;
function lastPriceAge(rec) {
  if (!rec || !rec.history || !rec.history.length) return Infinity;
  return Date.now() / 1000 - (rec.history[rec.history.length - 1].t || 0);
}
function isPriceStale(rec) {
  return lastPriceAge(rec) > STALE_SECONDS;
}

const MECHANICS = {
  speedflip: {
    name: 'Speed Flip',
    aliases: ['speedflip', 'speedflipkickoff'],
    tip: 'Diagonal-flip at 15-20 degrees, then instantly flick the stick straight DOWN to cancel the flip, then air roll to level your wheels. The Musty speed-flip kickoff test pack is the real check - if you can\'t reach the ball, your cancel is late or your angle is off.',
    url: 'https://www.youtube.com/watch?v=41nSg_NlWr4',
  },
  halfflip: {
    name: 'Half Flip',
    aliases: ['halfflip'],
    tip: 'Backflip, and halfway through (nose pointing down-back) push the stick forward to cancel, then hold a directional air roll to spin your wheels onto the ground. Bind ARL/ARR to a shoulder button so it becomes one clean motion instead of three.',
    url: 'https://www.youtube.com/watch?v=FtgzgYhApuU',
  },
  wavedash: {
    name: 'Wave Dash',
    aliases: ['wavedash', 'wavedashes'],
    tip: 'Jump, tilt so one side of your wheels points at the ground, then flip the instant you land while holding powerslide - it carries your momentum with zero boost. Chain them off walls and in net to recover faster than anyone who waits to land.',
    url: 'https://www.youtube.com/watch?v=Xk-XWaauhdA',
  },
  flipreset: {
    name: 'Flip Reset',
    aliases: ['flipreset', 'reset'],
    tip: 'Fly at the ball upside-down, let OFF boost, and pull the stick back so all four wheels "slap" the ball - that slap is what re-grants your dodge. Train the reset alone on a Wall-to-Air-Dribble pack before trying to score off it.',
    url: 'https://www.youtube.com/watch?v=ESxkKkvD_uM',
  },
  airdribble: {
    name: 'Air Dribble',
    aliases: ['airdribble', 'airdribbles'],
    tip: 'Jump the instant you touch the ball off the wall so you stay glued, then FEATHER boost (never hold) and sit 3/4 under the ball with your nose on the 5-o\'clock spot. Match ball speed - if you push it forward you\'re not dribbling, you\'re chasing.',
    url: 'https://www.youtube.com/watch?v=AsREWK-F370',
  },
  rotation: {
    name: 'Rotation',
    aliases: ['rotation', 'rotate'],
    tip: 'Fill the gap your teammates leave - it\'s never a fixed 1-2-3 order. Rotate to the BACK post (away from the ball) so you come in with momentum, and never cut in front of your own last man to hit a ball they\'re already covering.',
    url: 'https://www.youtube.com/watch?v=cVllW6eD-sA',
  },
  shadow: {
    name: 'Shadow Defense',
    aliases: ['shadow', 'shadowdefense', 'shadowdefend'],
    tip: 'Mirror the attacker slightly OFF the ball-to-goal line toward your far post, staying just outside their shot range. Throw a fake challenge (turn toward them, then back) to force them to flick early - then punish the mistake.',
    url: 'https://www.youtube.com/watch?v=j23wicsllMw',
  },
  fastaerial: {
    name: 'Fast Aerial',
    aliases: ['fastaerial', 'aerial', 'aerials'],
    tip: 'Hold the stick back + boost BEFORE you jump, hold the first jump ~1/5 second for max height, release the stick, then second jump. The order is jump-TILT-jump, not jump-jump-tilt - that\'s why you get beat to high balls.',
    url: 'https://www.youtube.com/watch?v=qSduNdQeL7Q',
  },
  airroll: {
    name: 'Directional Air Roll',
    aliases: ['airroll', 'dar', 'directionalairroll'],
    tip: 'Bind ARL or ARR to a shoulder button. With ARL held: stick down-right turns LEFT, stick up-right turns RIGHT - tornado spin controls your speed, those two directions control where you go. Practice rings maps at 25-50% game speed first.',
    url: 'https://www.youtube.com/watch?v=bYveY7WuDo0',
  },
  powershot: {
    name: 'Power Shot',
    aliases: ['powershot', 'shooting', 'shot'],
    tip: 'Wait for the ball to bounce, then hit the LOWER-MIDDLE of the ball with the nose/corner of your car and dodge into it right after the bounce - the bounce gives you free power. Hitting under the ball raises it, hitting higher keeps it low.',
    url: 'https://www.youtube.com/watch?v=jOjzJb4r3Zo',
  },
  dribble: {
    name: 'Dribbling & Flicks',
    aliases: ['dribble', 'dribbling', 'flick', 'flicks'],
    tip: 'Keep the ball in the center circle on your hood, NEVER tap brake (ease off gas instead), and steer with tiny stick nudges. The flick sweet spot is slightly back of center on your car - too far forward = no power, too far back = ball goes behind you.',
    url: 'https://www.youtube.com/watch?v=noLjmDoAq1s',
  },
  kickoff: {
    name: 'Kickoff',
    aliases: ['kickoff', 'kickoffs'],
    tip: 'Do ONE diagonal flip on the way in to save boost, and read the opponent\'s nameplate: hook the ball opposite them if you\'re on the same side, push it if opposite. Rule: "left goes" when both teammates can take it.',
    url: 'https://www.youtube.com/watch?v=nF68ltp01o0',
  },
  recovery: {
    name: 'Recoveries',
    aliases: ['recovery', 'recoveries', 'landing'],
    tip: 'Any bump that lifts all four wheels gives you a FREE flip to re-orient. When you land sideways, hold powerslide so you don\'t lose momentum, then flip in your travel direction. Practice front-flip-half-flip back and forth down the field.',
    url: 'https://www.youtube.com/watch?v=dywxcjl7B9E',
  },
  boost: {
    name: 'Boost Management',
    aliases: ['boost', 'pads', 'boostmanagement'],
    tip: 'Memorize the pad lanes (the oval = 8 pads, the triangle = 3) so you pick up pads WITHOUT looking. Never drop below ~30 boost while rotating back - small pads beat leaving position for a full boost.',
    url: 'https://www.youtube.com/watch?v=edWi_ATGh9A',
  },
  fifty: {
    name: '50/50s & Challenges',
    aliases: ['50', '5050', '50s', 'fifty', 'fifties'],
    tip: 'Win 50s by taking the INSIDE position so a loss deflects to the corner instead of your net. On low balls, turn your car sideways to center your hitbox, and dodge down into the ball for a "dunk" when you arrive from above.',
    url: 'https://www.youtube.com/watch?v=J0DfNsMYXgg',
  },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[discord-bot] ready as ${c.user.tag}`);
  try {
    accountStore.init();
    console.log('[discord-bot] account store initialized');
  } catch (e) {
    console.error('[discord-bot] account store init failed:', e.message);
  }
  (async () => {
    try {
      const r = await timezoneRoster.refresh(c);
      console.log(`[discord-bot] member-timezone roster: ${r.synced ? `synced ${r.count} entries` : `not synced (${r.reason})`}`);
    } catch (e) {
      console.error('[discord-bot] roster refresh failed:', e.message);
    }
    try {
      await updateMembersBoard();
    } catch (e) {
      console.error('[discord-bot] members board init failed:', e.message);
    }
  })();
  loadLinks();
  factionFeatures = createFactionFeatures({
    client,
    factionId: FACTION_ID,
    ownerKey: TORN_API_KEY,
    vaultKey: process.env.FACTION_VAULT_KEY || '',
    channelIds: { retaliation: RETALIATION_CHANNEL_ID, oc: OC_CHANNEL_ID, bank: BANK_CHANNEL_ID, verify: VERIFY_CHANNEL_ID },
    links,
    getLinks: () => links,
  });
  factionFeatures.startRetaliationMonitor();
  factionFeatures.startOCMonitor();
  startChainMonitor();
  startPriceWatcher();
  startWarMonitor();
  startDailyDigest();
  startDailyGuide();
  happyjumpCommands.startHappyJumpMonitor(client);
  meritsCommands.startMeritsMonitor(client);
  startGainMonitor(client);
  ttsCommands.initVoice(client);
  knownPlayers.load();
  knownPlayers.syncAll()
    .then((r) => console.log(`[known] initial sync: ${r.before} \u2192 ${r.after} (+${r.totalAdded})`))
    .catch((e) => console.error('[known] sync error:', e.message));
  setInterval(() => { knownPlayers.syncAll().catch(() => {}); }, 30 * 60 * 1000);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.startsWith(PREFIX)) {
    try {
      await handleCommand(message);
    } catch (e) {
      console.error(`[discord-bot] command error (${message.content.slice(0,40)}): ${e.stack || e.message}`);
      try {
        await message.reply(`\u274C Error running that command: ${e.message}`);
      } catch (_) {}
    }
    return;
  }
  if (!message.guild) {
    console.log(`[discord-bot] DM from ${message.author.tag}: ${message.content.slice(0, 60)}`);
    try {
      if (setupCommands.isPendingSetup(message.author.id)) {
        await setupCommands.handleDM(message);
      }
      // free-form DMs no longer route to an AI; ignore them
    } catch (e) {
      console.error('[discord-bot] DM handle failed:', e.message);
    }
  }
});

async function handleCommand(message) {
  wrapMessage(message);
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const rest = args.join(' ');

  switch (command) {
    case 'ping':
      await message.reply(`Pong! ${client.ws.ping}ms`);
      break;
    case 'dmtest':
      await handleDmTest(message);
      break;
    case 'help':
      await handleHelp(message);
      break;
    case 'ask':
      await message.reply('`!ask` has been removed. Use the live commands instead: `!bars`, `!gain`, `!torn <id>`, `!faction`, `!prices <item>`, `!item <name>`, `!crime-route`, `!levelpacer`. Run `!help` for the full list.');
      break;
    case 'tip':
      await handleTip(message, rest);
      break;
    case 'tips':
      await handleTipsList(message);
      break;
    case 'flip':
      await message.reply(Math.random() < 0.5 ? 'Heads' : 'Tails');
      break;
    case 'teams':
      await handleTeams(message);
      break;
    case 'torn':
      if (args[0] === 'setup') {
        await setupCommands.handleTornSetup(message);
      } else if (args[0] === 'status') {
        await setupCommands.handleTornStatus(message);
      } else if (args[0] === 'disconnect') {
        await setupCommands.handleTornDisconnect(message);
      } else {
        await handleTorn(message, args[0]);
      }
      break;
    case 'faction':
      await handleFaction(message, args[0]);
      break;
    case 'members':
      await handleMembers(message);
      break;
    case 'tz':
      await handleTimezone(message, rest);
      break;
    case 'territory':
      await handleTerritory(message);
      break;
    case 'verify':
      if (factionFeatures) await factionFeatures.handleVerify(message, rest);
      else await message.reply('Faction features not ready yet.');
      break;
    case 'bank':
      if (factionFeatures) await factionFeatures.handleBank(message, rest);
      else await message.reply('Faction features not ready yet.');
      break;
    case 'notify':
      if (factionFeatures) await factionFeatures.handleNotify(message, rest);
      else await message.reply('Faction features not ready yet.');
      break;
    case 'stock':
      await handleStock(message, rest);
      break;
    case 'travel':
      await handleTravel(message, rest);
      break;
    case 'abroad':
      await handleAbroad(message, rest);
      break;
    case 'link':
      await handleLink(message, rest);
      break;
    case 'guide':
      await handleGuide(message, rest);
      break;
    case 'interview':
      await handleInterview(message, rest);
      break;
    case 'item':
      await handleItem(message, rest);
      break;
    case 'prices':
      await handlePrices(message, args);
      break;
    case 'ph':
    case 'pricehistory':
      await handlePriceHistory(message, rest);
      break;
    case 'watch':
      await handleWatch(message, rest);
      break;
    case 'unwatch':
      await handleUnwatch(message, rest);
      break;
    case 'watchlist':
      await handleWatchlist(message);
      break;
    case 'flips':
      await handleFlip(message);
      break;
    case 'bars':
      await handleBars(message);
      break;
    case 'gain':
      await handleGain(message, args);
      break;
    case 'timers':
      await handleTimers(message);
      break;
    case 'crime':
    case 'crimeroute':
    case 'crime-route':
      await handleCrimeRoute(message);
      break;
    case 'flipcalc':
      await handleFlipCalc(message, args);
      break;
    case 'levelpacer':
    case 'pacer':
      await handleLevelPacer(message);
      break;
    case 'job':
    case 'jobapply':
    case 'job-apply':
      await handleJobApply(message, rest);
      break;
    case 'digest':
      await sendDailyDigest(message);
      break;
    case 'alert':
      await handleAlert(message, rest);
      break;
    case 'bulk':
      await handleBulk(message);
      break;
    case 'clear':
      await handleClear(message, args);
      break;
    case 'coach':
      await personalCommands.handleCoach(message);
      break;
    case 'education':
      await personalCommands.handleEducation(message);
      break;
    case 'money':
      await personalCommands.handleMoney(message);
      break;
    case 'target':
      await targetCommands.handleTarget(message, args);
      break;
    case 'baldr':
      await baldrCommands.handleBaldr(message, args);
      break;
    case 'junk':
      await junkCommands.handleJunk(message, args);
      break;
    case 'hj':
    case 'happyjump':
      await happyjumpCommands.handleHappyJump(message, args);
      break;
    case 'merits':
      await meritsCommands.handleMerits(message, args);
      break;
    case 'perks':
      await perksCommands.handlePerks(message, args);
      break;
    case 'courses':
      await coursesCommands.handleCourses(message, args);
      break;
    case 'activity':
      await rosterCommands.handleActivity(message, args);
      break;
    case 'roster':
      await rosterCommands.handleRoster(message, args);
      break;
    case 'finances':
      await factionStatsCommands.handleFinances(message);
      break;
    case 'chainreport':
      await factionStatsCommands.handleChainReport(message);
      break;
    case 'armory':
      await factionStatsCommands.handleArmory(message);
      break;
    case 'wars':
      await factionStatsCommands.handleWars(message);
      break;
    case 'arbitrage':
      await economyCommands.handleArbitrage(message);
      break;
    case 'points':
      await economyCommands.handlePoints(message);
      break;
    case 'auctions':
      await economyCommands.handleAuctions(message, args);
      break;
    case 'museum':
      await economyCommands.handleMuseum(message);
      break;
    case 'networth':
      await personalStatsCommands.handleNetworth(message);
      break;
    case 'medals':
      await personalStatsCommands.handleMedals(message, args);
      break;
    case 'jobinfo':
      await personalStatsCommands.handleJob(message);
      break;
    case 'events':
      await personalStatsCommands.handleEvents(message);
      break;
    case 'calendar':
      await eventsInfoCommands.handleCalendar(message);
      break;
    case 'dirtybombs':
      await eventsInfoCommands.handleDirtybombs(message);
      break;
    case 'bounties':
      await eventsInfoCommands.handleBounties(message);
      break;
    case 'ocs':
      await eventsInfoCommands.handleOcs(message);
      break;
    case 'known':
      await knownCommands.handleKnown(message, args);
      break;
    case 'tts':
      await ttsCommands.handleTts(message, args);
      break;
    case 'say':
      await ttsCommands.handleSay(message, args);
      break;
    case 'image':
      await imageCommands.handleImage(message, args);
      break;
  }
}

async function handleTip(message, query) {
  const q = (query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (q) {
    for (const m of Object.values(MECHANICS)) {
      if (m.aliases.includes(q)) {
        await message.reply(formatTip(m));
        return;
      }
    }
    await message.reply(`No guide for "${query}". Try \`!tips\` for the list.`);
    return;
  }
  const keys = Object.keys(MECHANICS);
  const m = MECHANICS[keys[Math.floor(Math.random() * keys.length)]];
  await message.reply(formatTip(m));
}

async function handleTipsList(message) {
  const names = Object.values(MECHANICS)
    .map((m) => `\`${m.aliases[0]}\``)
    .join(' ');
  await message.reply(`Available mechanics:\n${names}\n\nUse \`!tip <name>\`, e.g. \`!tip airroll\`.`);
}

function formatTip(m) {
  return `**${m.name}**\n${m.tip}\nGuide: ${m.url}`;
}

async function handleTeams(message) {
  const players = Array.from(message.mentions.users.values()).filter((u) => !u.bot);
  if (players.length < 2) {
    await message.reply('Mention at least 2 players: `!teams @a @b @c @d @e @f`');
    return;
  }
  const shuffled = shuffle(players);
  const half = Math.floor(shuffled.length / 2);
  const teamA = shuffled.slice(0, half);
  const teamB = shuffled.slice(half);
  let out = `**Blue:** ${teamA.join(' ')}\n**Orange:** ${teamB.join(' ')}`;
  if (shuffled.length % 2 === 1) {
    out += `\n\u26a0\ufe0f Odd count (${shuffled.length} players) — one team has an extra; reroll or add a player.`;
  }
  await message.reply(out);
}

// --- Torn ---

async function tornGet(section, id, selections, version, keyOrIndex = 0) {
  let key;
  if (typeof keyOrIndex === 'string' && keyOrIndex.length > 10) {
    key = keyOrIndex;
  } else if (keyOrIndex === 1) {
    key = TORN_API_KEY_2 || TORN_API_KEY;
  } else {
    key = TORN_API_KEY;
  }
  if (!key) throw new Error('Torn API key is not set (add TORN_API_KEY to .env)');
  const sid = id ? `/${encodeURIComponent(id)}` : '';
  const ver = version === 2 ? '/v2' : '';
  const url = `https://api.torn.com${ver}/${section}${sid}?selections=${selections}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.error)) {
    const msg = data && data.error ? data.error.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function handleTorn(message, id) {
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', id, 'profile,battlestats,networth');
    const lines = [];
    lines.push(`**${d.name || 'Player'}** [${d.player_id || id || 'you'}]`);
    if (d.level != null) lines.push(`Level: ${d.level}  •  Rank: ${d.rank || '?'}`);
    if (d.age != null || d.gender) lines.push(`Age: ${d.age ?? '?'}  •  Gender: ${d.gender || '?'}  •  Role: ${d.role || '?'}`);
    if (d.status && d.status.state) lines.push(`Status: ${d.status.state}${d.status.description ? ' — ' + d.status.description : ''}`);
    const total = d.total ?? ((d.strength || 0) + (d.defense || 0) + (d.speed || 0) + (d.dexterity || 0));
    if (total) lines.push(`Battle stats: **${fmt(total)}** (Str ${d.strength ?? '?'} / Def ${d.defense ?? '?'} / Spd ${d.speed ?? '?'} / Dex ${d.dexterity ?? '?'})`);
    const nw = networthTotal(d);
    if (nw) lines.push(`Networth: **$${fmt(nw)}**`);
    if (d.honor != null) lines.push(`Honor: ${d.honor}`);
    if (d.faction && Number(d.faction.faction_id) > 0) {
      lines.push(`Faction: ${d.faction.faction_name || ''} [${d.faction.faction_id}]`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleFaction(message, id) {
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('faction', id || FACTION_ID, 'basic');
    const memberList = Object.values(d.members || {});
    const members = memberList.length;
    const rankName = d.rank ? `${d.rank.name || ''}${d.rank.level ? ' ' + d.rank.level : ''}` : '?';
    const avgLevel = memberList.length ? Math.round(memberList.reduce((s, m) => s + (m.level || 0), 0) / memberList.length) : '?';
    const lines = [];
    lines.push(`**${d.name || 'Faction'}** [${d.tag || d.ID}]`);
    lines.push(`Respect: ${fmt(d.respect || 0)}  •  Rank: ${rankName}`);
    lines.push(`Members: ${members}${d.capacity ? '/' + d.capacity : ''}  •  Avg level: ${avgLevel}  •  Age: ${d.age || '?'}d`);
    lines.push(`Leader: ${d.leader ? idOrName(d.leader, d.members) : '?'}`);
    if (d['co-leader']) lines.push(`Co-leader: ${idOrName(d['co-leader'], d.members)}`);
    if (d.best_chain != null) lines.push(`Best chain: ${d.best_chain}`);
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleMembers(message) {
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('faction', FACTION_ID, 'basic');
    const tzLookup = {};
    for (const acct of accountStore.getAllAccounts()) {
      if (acct.torn_username) tzLookup[acct.torn_username.trim().toLowerCase()] = acct.timezone || null;
    }
    const entries = Object.values(d.members || {}).map((m) => ({
      name: m.name,
      level: m.level,
      position: m.position,
      online: m.last_action && m.last_action.status === 'Online',
      state: m.status ? m.status.state : null,
      lastAction: m.last_action ? m.last_action.timestamp : null,
      timezone: tzLookup[String(m.name).trim().toLowerCase()] || timezoneRoster.timezoneForTornName(m.name),
    }));
    entries.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (b.level || 0) - (a.level || 0);
    });
    const lines = [`\u{1F465} **${d.name || 'Faction'}** \u2014 ${entries.length} member${entries.length === 1 ? '' : 's'}`];
    for (const e of entries) {
      const tz = e.timezone ? tzNormalize.normalize(e.timezone).display : null;
      let icon = '\u26AA';
      if (e.online) icon = '\u{1F7E2}';
      else if (e.state === 'Traveling') icon = '\u2708\uFE0F';
      else if (e.state === 'Hospital') icon = '\u{1F3E5}';
      else if (e.state === 'Jail') icon = '\u{1F512}';
      lines.push(`${icon} **${e.name}** \u2014 ${e.position}, L${e.level}${tz ? `, ${tz}` : ''}`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleTimezone(message, query) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('Connect your Torn account first: `!torn setup`, then `!tz <timezone>`.\nOr set it in `#📌︱member-intro` and it will be picked up automatically.');
    return;
  }
  const arg = (query || '').trim();
  if (!arg) {
    await message.reply(account.timezone
      ? `Your recorded timezone is **${account.timezone}**. Update it with \`!tz <timezone>\`.`
      : 'No timezone set yet. Use `!tz <timezone>` (e.g. `!tz Eastern US`, `!tz UTC+1`, `!tz Australia`).');
    return;
  }
  const normalized = tzNormalize.normalize(arg).display;
  accountStore.setTimezone(userId, normalized);
  await message.reply(`Timezone set: **${normalized}** \u2014 it will now show in \`!members\`.`);
}

async function handleTerritory(message) {
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('faction', FACTION_ID, 'territory');
    const territory = d.territory || {};
    const count = Array.isArray(territory) ? territory.length : Object.keys(territory).length;
    if (!count) {
      await reply.edit('\u{1F3D4}\uFE0F No territory currently held.');
      return;
    }
    const lines = [`\u{1F3D4}\uFE0F **Territory** \u2014 ${count} tile${count === 1 ? '' : 's'}`];
    if (Array.isArray(territory)) {
      for (const t of territory) {
        lines.push(`\u2022 ${typeof t === 'string' ? t : (t.name || t.sector || JSON.stringify(t))}`);
      }
    } else {
      for (const [k, v] of Object.entries(territory)) {
        lines.push(`\u2022 ${v && v.name ? v.name : k}`);
      }
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleStock(message, query) {
  if (!query) {
    await message.reply('Usage: `!stock <item>` (e.g. `!stock first aid`)');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('torn', '', 'cityshops');
    const shops = d.cityshops || {};
    const results = [];
    for (const shop of Object.values(shops)) {
      for (const item of Object.values(shop.inventory || {})) {
        if ((item.name || '').toLowerCase().includes(query.toLowerCase())) {
          results.push({ shop: shop.name, name: item.name, price: item.price, stock: item.in_stock });
        }
      }
    }
    if (!results.length) {
      await reply.edit(`No Torn City shop sells "${query}".`);
      return;
    }
    results.sort((a, b) => (b.stock || 0) - (a.stock || 0));
    const lines = [`\u{1F3EC} **"${query}" in Torn City shops**`];
    for (const r of results) {
      lines.push(`**${r.name}** \u2014 ${r.shop}: $${fmt(r.price)} \u00B7 ${fmt(r.stock)} in stock`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function yataGet() {
  const res = await fetch('https://yata.yt/api/v1/travel/export/');
  const data = await res.json();
  return data.stocks || {};
}

async function handleTravel(message, query) {
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await yataGet();
    if (!query) {
      const lines = ['\u2708\uFE0F **Travel destinations** \u2014 use `!travel <country>`'];
      for (const code of Object.keys(COUNTRY_NAMES)) {
        const c = d[code];
        const inStock = c ? c.stocks.filter((s) => s.quantity > 0).length : 0;
        lines.push(`\u2022 ${COUNTRY_NAMES[code]} (${code}) \u2014 ${inStock} in stock`);
      }
      await reply.edit(lines.join('\n'));
      return;
    }
    const code = COUNTRY_CODES[query.toLowerCase().trim()];
    if (!code) {
      await reply.edit(`Unknown country "${query}". Options: ${Object.keys(COUNTRY_NAMES).join(', ')}`);
      return;
    }
    const c = d[code];
    if (!c) {
      await reply.edit(`No data for ${COUNTRY_NAMES[code]}.`);
      return;
    }
    const inStock = c.stocks.filter((s) => s.quantity > 0).sort((a, b) => b.quantity - a.quantity);
    const lines = [`\u2708\uFE0F **${COUNTRY_NAMES[code]}** \u2014 ${inStock.length} item${inStock.length === 1 ? '' : 's'} in stock (${timeAgo(c.update)})`];
    for (const s of inStock.slice(0, 30)) {
      lines.push(`**${s.name}** \u2014 $${fmt(s.cost)} \u00B7 ${fmt(s.quantity)} in stock`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`YATA error: ${e.message}`);
  }
}

async function handleAbroad(message, query) {
  if (!query) {
    await message.reply('Usage: `!abroad <item>`');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await yataGet();
    const results = [];
    for (const [code, c] of Object.entries(d)) {
      for (const s of c.stocks) {
        if (s.quantity > 0 && (s.name || '').toLowerCase().includes(query.toLowerCase())) {
          results.push({ country: COUNTRY_NAMES[code] || code, name: s.name, qty: s.quantity, cost: s.cost });
        }
      }
    }
    if (!results.length) {
      await reply.edit(`No country has "${query}" in stock right now.`);
      return;
    }
    results.sort((a, b) => b.qty - a.qty);
    const lines = [`\u{1F30D} **"${query}" abroad**`];
    for (const r of results.slice(0, 30)) {
      lines.push(`${r.country}: **${r.name}** $${fmt(r.cost)} \u00B7 ${fmt(r.qty)} in stock`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`YATA error: ${e.message}`);
  }
}

async function handleDmTest(message) {
  try {
    await message.author.send('\u{1F4EC} **DM test** \u2014 if you can see this, your DMs work. Reply here and I should answer back.');
    await message.reply('Sent you a DM \u2014 check your private messages.');
  } catch (e) {
    await message.reply(`Could not DM you: ${e.message}`);
  }
}

async function handleLink(message, query) {
  const id = (query || '').trim();
  if (!/^\d+$/.test(id)) {
    await message.reply('Usage: `!link <your Torn player ID>` (the number in your Torn profile URL)');
    return;
  }
  links[message.author.id] = id;
  saveLinks();
  await message.reply(`Linked! Your Discord is now tied to Torn player #${id}. Use \`!guide\`.`);
}

async function handleGuide(message, arg) {
  const toggle = (arg || '').trim().toLowerCase();
  if (toggle === 'on' || toggle === 'off' || toggle === 'status') {
    return handleGuideToggle(message, toggle);
  }
  let tornId = null;
  const mention = message.mentions.users.first();
  if (mention) {
    tornId = links[mention.id];
    if (!tornId) {
      await message.reply(`<@${mention.id}> hasn't linked their Torn ID yet.`);
      return;
    }
  } else if (arg && /^\d+$/.test(arg.trim())) {
    tornId = arg.trim();
  } else if (arg) {
    await message.reply('Usage: `!guide` (your linked player), `!guide <torn-id>`, or `!guide @user`');
    return;
  } else {
    tornId = links[message.author.id];
    if (!tornId) {
      await message.reply('Link your Torn ID first: `!link <your player ID>`, or use `!guide <torn-id>`.');
      return;
    }
  }

  try {
    const isOwner = String(tornId) === String(await getOwnerId());
    let d;
    let factionInfo = null;
    if (isOwner) {
      d = await tornGet('user', tornId, 'profile,battlestats,networth,bars');
    } else {
      d = await tornGet('user', tornId, 'basic');
      try {
        const f = await tornGet('faction', FACTION_ID, 'basic');
        if (f.members && f.members[tornId]) {
          factionInfo = { inTracked: true, factionName: f.name || 'your faction' };
        }
      } catch (e) {}
    }
    const guide = buildGuide(d, factionInfo);
    try {
      const n = await dmChunks(message, guide);
      await message.reply(`\u{1F4EC} Full guide sent to your DMs (${n} message${n === 1 ? '' : 's'}).`);
    } catch (e) {
      await message.reply(guide);
    }
  } catch (e) {
    await message.reply(`Torn error: ${e.message}`);
  }
}

async function buildPlayerGuide(tornId) {
  const isOwner = String(tornId) === String(await getOwnerId());
  let d;
  let factionInfo = null;
  if (isOwner) {
    d = await tornGet('user', tornId, 'profile,battlestats,networth,bars');
  } else {
    d = await tornGet('user', tornId, 'basic');
    try {
      const f = await tornGet('faction', FACTION_ID, 'basic');
      if (f.members && f.members[tornId]) {
        factionInfo = { inTracked: true, factionName: f.name || 'your faction' };
      }
    } catch (e) {}
  }
  return buildDailyPlaybook(d, factionInfo);
}

function truncateGuide(text, max = 2000) {
  if (!text || text.length <= max) return text;
  const headroom = max - 60;
  const cut = text.slice(0, headroom);
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'));
  const end = lastBreak > max * 0.5 ? lastBreak : headroom;
  return text.slice(0, end) + '\n… (_guide trimmed to fit the DM — run `!guide` for the full version_)';
}

async function handleGuideToggle(message, toggle) {
  const uid = message.author.id;
  if (toggle === 'on') {
    const tornId = links[uid];
    if (!tornId) {
      await message.reply('Link your Torn ID first: `!link <your player ID>`, then `!guide on`.');
      return;
    }
    priceData.guideSubs = priceData.guideSubs || {};
    priceData.guideSubs[uid] = { msg: null };
    savePrices();
    try {
      const guide = await buildPlayerGuide(tornId);
      const dm = await message.author.send(`\u{1F9ED} **Daily playbook: ON** \u2014 I\u2019ll DM you your daily Torn playbook once a day (10:00 local) and update the same message so it doesn\u2019t spam.\n\n${guide}`);
      priceData.guideSubs[uid] = { msg: { channelId: dm.channelId, messageId: dm.id } };
      savePrices();
      await message.reply('\u{1F9ED} Daily guide ON \u2014 I\u2019ll DM you each morning. Check your DMs for today\u2019s.');
    } catch (e) {
      await message.reply(`Could not send today's guide: ${e.message}`);
    }
  } else if (toggle === 'off') {
    if (priceData.guideSubs && priceData.guideSubs[uid]) {
      delete priceData.guideSubs[uid];
      savePrices();
      await message.reply('Your daily guide is now OFF.');
    } else {
      await message.reply('Daily guide isn\u2019t on for you. Use `!guide on` to start.');
    }
  } else {
    if (priceData.guideSubs && priceData.guideSubs[uid]) {
      await message.reply(`Daily guide ON for you \u2014 I\u2019ll DM your playbook each day at 10:00.`);
    } else {
      await message.reply('Your daily guide is OFF. Use `!guide on` to get a daily DM.');
    }
  }
}

const GUIDE_HOUR = Number(process.env.GUIDE_HOUR) || 10;

function startDailyGuide() {
  if (process.env.GUIDE_DISABLED === '1') {
    console.log('[discord-bot] daily guide disabled (GUIDE_DISABLED)');
    return;
  }
  console.log(`[discord-bot] daily guide scheduled (${GUIDE_HOUR}:00 local)`);
  const run = () => {
    (async () => {
      try {
        await deliverDailyGuide();
      } catch (e) {
        console.error('[discord-bot] daily guide failed:', e.message);
      }
    })();
  };
  const now = new Date();
  const next = new Date(now);
  next.setHours(GUIDE_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const waitMs = next - now;
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, waitMs);
}

async function deliverDailyGuide() {
  const subs = priceData.guideSubs || {};
  const uids = Object.keys(subs);
  if (!uids.length) return;
  const header = `\u{1F9ED} **Daily Torn playbook** \u2014 ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}\n`;
  for (const uid of uids) {
    try {
      const tornId = links[uid];
      if (!tornId) continue;
      const guide = await buildPlayerGuide(tornId);
      const body = header + guide;
      const user = await client.users.fetch(uid);
      if (!user) continue;
      const entry = subs[uid] || {};
      if (entry.msg) {
        let ok = false;
        try {
          const channel = await client.channels.fetch(entry.msg.channelId);
          const m = await channel.messages.fetch(entry.msg.messageId);
          await m.edit(body);
          ok = true;
        } catch (e) {
          entry.msg = null;
        }
        if (ok) {
          savePrices();
          continue;
        }
      }
      const dm = await user.send(body);
      entry.msg = { channelId: dm.channelId, messageId: dm.id };
      savePrices();
    } catch (e) {
      console.error(`[discord-bot] guide DM failed for ${uid}:`, e.message);
    }
  }
}

function inventoryAdvice(owned) {
  const rules = [
    { key: 'glasses', action: 'keep', why: 'crime enhancer (+5% CE & skill) \u2014 keep equipped forever' },
    { key: 'card skimmer', action: 'keep', why: 'feeds the Card Skimming crime \u2014 don\u2019t trash' },
    { key: 'personal computer', action: 'keep', why: 'used in crimes/outcomes' },
    { key: 'driver', action: 'keep', why: 'unlocks crime outcomes later' },
    { key: 'cannabis', action: 'use', why: '+nerve & crime success \u2014 take before crime chains' },
    { key: 'beer', action: 'use', why: 'drink for +1 nerve before crime chains' },
    { key: 'vitamins', action: 'keep', why: 'heals life \u2014 keep for when you\u2019re hospitalized' },
    { key: 'leather gloves', action: 'equip', why: 'armor \u2014 equip one' },
    { key: 'tissues', action: 'keep', why: 'restores a little life' },
    { key: 'phone card', action: 'keep', why: 'used in crime outcomes' },
    { key: 'hammer', action: 'sell', why: 'weak weapon \u2014 sell once you get a real melee weapon' },
    { key: 'magazine', action: 'sell', why: 'junk \u2014 sell or trash' },
    { key: 'receipt', action: 'sell', why: 'junk \u2014 sell or trash' },
    { key: 'chocolate bars', action: 'hold', why: 'candy \u2014 save for a happy jump (or sell if you need cash)' },
    { key: 'sweet hearts', action: 'hold', why: 'candy \u2014 save for a happy jump' },
    { key: 'bon bons', action: 'hold', why: 'candy \u2014 save for a happy jump' },
    { key: 'extra strong mints', action: 'hold', why: 'candy \u2014 save for a happy jump' },
    { key: 'dvd', action: 'use', why: 'Bootlegging \u2014 copy + sell in bulk for crime skill & cash (don\u2019t sell raw)' },
    { key: 'crazy straw', action: 'keep', why: 'temp/booster \u2014 safe to keep' },
  ];
  const advice = {};
  let found = 0;
  const hay = owned.join(' ').toLowerCase();
  for (const r of rules) {
    if (hay.includes(r.key)) {
      advice[r.action] = advice[r.action] || [];
      advice[r.action].push(`${r.key} \u2014 ${r.why}`);
      found++;
    }
  }
  if (!found) return null;
  const lines = [];
  const order = ['keep', 'equip', 'use', 'hold', 'sell'];
  const labels = { keep: '\u{1F4E6} KEEP', equip: '\u{1F3AA} EQUIP', use: '\u{1F37A} USE NOW', hold: '\u{1F3E1} HOLD', sell: '\u{1F4B0} SELL/TRASH' };
  for (const k of order) {
    if (advice[k] && advice[k].length) lines.push(`${labels[k]}:\n${advice[k].map((x) => `  \u2022 ${x}`).join('\n')}`);
  }
  return lines.join('\n');
}

function buildGuide(d, factionInfo) {
  const level = d.level || 1;
  const name = d.name || 'Player';
  const hasFull = d.total != null || d.strength != null;

  if (!hasFull) {
    const steps = [];
    if (level < 15) {
      steps.push(`\u{1F3AF} **Reach level 15** (you're ${level}) to unlock travel. Attack and \u201cLeave\u201d inactive players for XP; spend nerve on crimes.`);
    } else {
      steps.push(`\u2708\uFE0F **Fly & flip** \u2014 buy plushies in UAE, flowers in Hawaii; resell in Torn. Use \`!travel\` + \`!abroad\`.`);
    }
    if (factionInfo && factionInfo.inTracked) {
      steps.push(`\u2694\uFE0F **Faction** \u2014 you're in ${factionInfo.factionName}. Run chains + organized crime for respect and cash.`);
    } else {
      steps.push(`\u2694\uFE0F **Faction** \u2014 if you're not in one, join an active faction (chains, OC, bank).`);
    }
    steps.push(`\u{1F4AA} **Train stats** \u2014 spend energy in the gym every time it fills; happy jump once you have cash.`);
    steps.push(`\u{1F393} **Education** \u2014 General Studies, then Sports Science + Biology.`);
    steps.push(`\u{1F3E6} **Bank** \u2014 compound interest, safe from muggers.`);
    const status = d.status && d.status.state && d.status.state !== 'Okay' ? ` \u00B7 ${d.status.state}` : '';
    return `\u{1F9ED} **${name}** \u2014 Level ${level}${status}\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  }

  const age = d.age != null ? d.age : null;
  const total = d.total || ((d.strength || 0) + (d.defense || 0) + (d.speed || 0) + (d.dexterity || 0));
  const nw = networthTotal(d) || 0;
  const factionId = d.faction ? Number(d.faction.faction_id) : 0;

  const header = `\u{1F9ED} **${name}** \u2014 Level ${level}${age != null ? ` \u00B7 ${age}d old` : ''} \u00B7 $${fmt(nw)} \u00B7 ${fmt(total)} stats`;
  let statusLine = '';
  if (d.energy && d.nerve) {
    statusLine = `\u26A1 Energy ${d.energy.current}/${d.energy.maximum} \u00B7 Nerve ${d.nerve.current}/${d.nerve.maximum} \u00B7 Happy ${d.happy ? d.happy.current + '/' + d.happy.maximum : '?'}`;
  }

  const steps = [];
  steps.push(`\u{1F3C6} **Fast-Track to 15 = attack & leave (CRIMES DON'T LEVEL YOU FAST)**\nAttacking a player and clicking **LEAVE** gives 100% of the XP (mug \u224855%, hospitalize \u224840%). This is far and away your #1 leveling engine \u2014 NOT crimes. Use \`!target\` to find easy kills near your level, or hit weak high-level inactives on a leveling list (Baldr's List: oran.pw/baldrstargets), then **always Leave**.`);
  steps.push(`\u{1F4AA} **Step 1: train your battle stats in the gym (ENERGY)**\nEnergy = gym training + attacks, not crimes. You're at **${fmt(total)}** total \u2014 push toward **~500** before leveling targets open up reliably. Every energy refill \u2192 **City \u2192 Gym \u2192 train Strength + Speed**. Keep happiness high (cheap candy \u2014 \`!hj\` walks you through a full happy jump). Stop overspending here once you can win fights.`);
  steps.push(`\u{1F9E9} **Step 2: nerve \u2192 crimes (long-term, not for leveling)**\nNerve is only for crimes. Use the cheap Crimes 2.0 options \u2014 **Search for Cash** (2 nerve, get the **Glasses** enhancer early = +5% CE & skill forever), **Bootlegging** (copy + sell DVDs in bulk), and safe **Shoplifting** (Sally\u2019s / Bits \u2018n\u2019 Bobs). Do crimes in a **chain when nerve is full** (better success + skill). Never jail yourself \u2014 jailing loses % of Crime Experience.`);
  steps.push(`\u{1F3E6} **Spend your MERITS (Awards \u2192 Merits / the [use] next to Merits)**\nIf you have merits banked, your first spend is **Education Length** (>2% course time forever, compounds). After that: **Bank Interest** to 10 (best passive income), then Nerve Bar / Crime XP / Life Points as you need. **There is no stat-distribution slider** \u2014 battle stats grow only from **Energy \u2192 Gym**, nerve grows from crimes, merits are spent at Awards.`);
  steps.push(`\u{1F4B0} **Every-day money before 15: the city-shop resell**\nBuy **100 items/day** from city shops and resell on the Item Market (~$50\u201375k/day): **Beer + basic plushies** (Bits 'n' Bobs), **Lollipops** (Sally's), **Blank DVDs** (Superstore). City shops **sell out & restock randomly** \u2014 if Beer's out, buy plushies/lollipops/DVDs instead. Mind the **5% market fee** (\`!flipcalc\` handles it).`);
  if (factionId === 0) {
    steps.push(`\u2694\uFE0F **Join a faction**\nYou're factionless. A faction with 1M+ respect gives gym perks, energy perks, protection \u2014 and travel capacity at 15. Apply to Royal Selection or any active faction; it's worth more than almost anything you can buy.`);
  } else {
    steps.push(`\u2694\uFE0F **Faction: ${d.faction.faction_name || '#' + d.faction.faction_id}**\nRun chains (attack while the faction is chaining) and organized crime when it's up.`);
  }
  steps.push(`\u{1F393} **Education**\nStart **Sports Science** ASAP (bigger gym gains \u2014 the long-term multiplier), then **Intravenous Therapy** (Biology \u2014 use blood bags, cheaper than morphine), then **Combat Training**. Keep education running always \u2014 \`!courses\` lists every course with its stat gains.`);
  steps.push(`\u{1F3E6} **Bank your money**\nDeposit into the City bank \u2014 compound interest, safe from muggers. Never hold cash in your wallet.`);
  steps.push(`\u2708\uFE0F **Goal: level 15 \u2192 travel = real money**\nAt 15, fly abroad \u2014 **buy flowers/plushies \u2192 trade at the Museum for Points \u2192 sell the Points for cash** (post-2024 meta, ~$3\u20135M/day). Rent a PI with airstrip + pilot, join a faction with Excursion perks, and use **Switzerland for rehab** once you use Xanax.\n\n\`!levelpacer\` tracks your pace; attack-and-leave is ~120\u2013260 attacks to 15.`);

  let guide = header + (statusLine ? '\n' + statusLine : '') + '\n\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n');

  return guide;
}

function buildDailyPlaybook(d, factionInfo) {
  const level = d.level || 1;
  const name = d.name || 'Player';
  const total = d.total || ((d.strength || 0) + (d.defense || 0) + (d.speed || 0) + (d.dexterity || 0));
  const nw = networthTotal(d) || 0;
  const lines = [];
  lines.push(`\u2611\uFE0F ${name} \u2014 Level ${level} \u00B7 $${fmt(nw)} \u00B7 ${fmt(total)} battle stats`);
  lines.push('');
  if (level < 15) {
    lines.push(`\u{1F3C6} **Today's focus \u2192 level 15**`);
    lines.push(`\u2022 **Battle** \u2014 attack inactive players and **Leave** (100% XP). Targets: oran.pw/baldrstargets`);
    lines.push(`\u2022 **Energy** \u2192 gym: train Strength + Speed`);
    lines.push(`\u2022 **Nerve** \u2192 crimes: Search for Cash, Bootlegging DVDs, Shoplifting`);
    lines.push(`\u2022 **Cash** \u2192 buy 100 city-shop items (Beer/plushies/Lollipops/DVDs), resell on market`);
    lines.push(`\u2022 **Education** \u2192 keep a course running (Sports Science first)`);
  } else {
    lines.push(`\u2708\uFE0F **Travel money** \u2014 fly, buy plushies/flowers \u2192 Museum \u2192 Points \u2192 cash`);
    lines.push(`\u2022 **Energy** \u2192 gym: train Strength + Speed`);
    lines.push(`\u2022 **Nerve** \u2192 crimes or chain`);
  }
  if (factionInfo && factionInfo.inTracked) {
    lines.push(`\u2022 **Faction** \u2014 in ${factionInfo.factionName}: run chains + OC when up`);
  } else if (!d.faction || Number(d.faction.faction_id) === 0) {
    lines.push(`\u2022 **Faction** \u2014 you're factionless: join one for gym/energy perks`);
  }
  lines.push(`\u2022 **Bank** \u2014 deposit cash (compound interest)`);
  lines.push('');
  lines.push(`_Full walkthrough: \`!guide\`_`);
  return lines.join('\n');
}

async function handleInterview(message, query) {
  const jobs = Object.keys(INTERVIEW);
  if (!query) {
    await message.reply(`Usage: \`!interview <job>\` \u2014 jobs: ${jobs.join(', ')}`);
    return;
  }
  const job = INTERVIEW[query.toLowerCase().trim()];
  if (!job) {
    await message.reply(`Unknown job "${query}". Options: ${jobs.join(', ')}`);
    return;
  }
  const lines = [`\u{1F4BC} **${job.name} interview answers**`];
  for (const [q, a] of job.qa) {
    lines.push(`**Q:** ${q}\n**A:** ${a}`);
  }
  await message.reply(lines.join('\n'));
}

function idOrName(id, members) {
  if (members && members[id]) return members[id].name || `#${id}`;
  return `#${id}`;
}

function marketStats(listings) {
  if (!listings.length) return null;
  const lowest = Math.min(...listings.map((l) => l.price));
  const totalAmount = listings.reduce((s, l) => s + l.amount, 0);
  const vwap = Math.round(listings.reduce((s, l) => s + l.price * l.amount, 0) / totalAmount);
  const sorted = listings.slice().sort((a, b) => a.price - b.price);
  let acc = 0;
  let median = sorted[0].price;
  const half = totalAmount / 2;
  for (const l of sorted) {
    acc += l.amount;
    if (acc >= half) {
      median = l.price;
      break;
    }
  }
  return { lowest, vwap, median, totalAmount, listingCount: listings.length };
}

async function handlePrices(message, args) {
  const raw = args.join(' ').trim();
  if (!raw) {
    await message.reply('Usage: \`!prices <item> [<item> ...]\` (use commas to separate multiple items; spaces within a name are allowed)');
    return;
  }
  let queries;
  if (raw.includes(',')) {
    queries = raw.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  } else {
    queries = [raw.replace(/^["']|["']$/g, '')];
  }
  if (queries.length > 20) {
    await message.reply('Max 20 items per scan.');
    return;
  }
  const reply = await message.reply('Scanning market\u2026');
  const lines = [];
  const items = await getItemsCache().catch(() => ({}));
  for (const q of queries) {
    let itemId = q;
    let itemName = '';
    if (!/^\d+$/.test(q)) {
      const found = Object.entries(items).find(([, it]) => (it.name || '').toLowerCase() === q.toLowerCase());
      if (!found) {
        lines.push(`**${q}** \u2014 not found`);
        continue;
      }
      itemId = found[0];
      itemName = found[1].name;
    }
    try {
      const d = await tornGet('market', itemId, 'itemmarket', 2);
      const im = d.itemmarket || {};
      const name = itemName || (im.item && im.item.name) || `#${itemId}`;
      const listings = (im.listings || [])
        .map((l) => ({ price: Number(l.price) || 0, amount: Number(l.amount) || 0 }))
        .filter((l) => l.price > 0);
      const stats = marketStats(listings);
      if (!stats) {
        lines.push(`**${name}** \u2014 no listings`);
      } else {
        lines.push(`**${name}** \u2014 $${fmt(stats.lowest)}`);
      }
    } catch (e) {
      lines.push(`**${q}** \u2014 error`);
    }
  }
  await reply.edit(lines.join('\n') || 'No items.');
}

let itemsCache = null;
let itemsCacheTime = 0;

async function getItemsCache() {
  if (itemsCache && Date.now() - itemsCacheTime < 24 * 3600 * 1000) return itemsCache;
  const d = await tornGet('torn', '', 'items');
  itemsCache = d.items || {};
  itemsCacheTime = Date.now();
  return itemsCache;
}

async function handleItem(message, query) {
  const reply = await message.reply('Fetching\u2026');
  try {
    if (!query) {
      await reply.edit('Usage: `!item <name or id>`');
      return;
    }
    let itemId = query;
    let itemName = '';
    if (!/^\d+$/.test(query)) {
      const items = await getItemsCache();
      const found = Object.entries(items).find(([, it]) => (it.name || '').toLowerCase() === query.toLowerCase());
      if (!found) {
        await reply.edit(`Item "${query}" not found.`);
        return;
      }
      itemId = found[0];
      itemName = found[1].name;
    }
    const d = await tornGet('market', itemId, 'itemmarket', 2);
    const im = d.itemmarket || {};
    const name = itemName || (im.item && im.item.name) || `Item #${itemId}`;
    const type = im.item && im.item.type ? im.item.type : '';
    const listings = (im.listings || [])
      .map((l) => ({ price: Number(l.price) || 0, amount: Number(l.amount) || 0 }))
      .filter((l) => l.price > 0);
    const stats = marketStats(listings);
    if (!stats) {
      await reply.edit(`**${name}**${type ? ' [' + type + ']' : ''} — no listings on the market.`);
      return;
    }
    const lines = [`**${name}**${type ? ' [' + type + ']' : ''} [#${itemId}]`];
    lines.push(`Lowest: **$${fmt(stats.lowest)}**`);
    lines.push(`Avg (live): **$${fmt(stats.vwap)}**  •  Median: **$${fmt(stats.median)}**`);
    lines.push(`For sale: ${fmt(stats.totalAmount)} units  •  ${stats.listingCount} listings`);
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleBars(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', '', 'bars,cooldowns', 1, apiKey);
    const lines = [];
    lines.push(`**${account.tornUsername}**`);
    if (d.energy) lines.push(`Energy: **${bar(d.energy)}**`);
    if (d.nerve) lines.push(`Nerve: **${bar(d.nerve)}**`);
    if (d.happy) lines.push(`Happy: **${bar(d.happy)}**`);
    if (d.life) lines.push(`Life: **${bar(d.life)}**`);
    if (d.chain) lines.push(`Chain: **${d.chain.current ?? 0}**/${d.chain.maximum ?? 0}`);
    if (d.cooldowns) {
      const cd = [];
      for (const k of ['drug', 'medical', 'booster']) {
        if (d.cooldowns[k] != null) cd.push(`${k}: ${fmtSeconds(d.cooldowns[k])}`);
      }
      if (cd.length) lines.push(`Cooldowns — ${cd.join('  •  ')}`);
    }
    await reply.edit(lines.join('\n') || 'No bars data.');
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

function bar(b) {
  const cur = b.current != null ? b.current : '?';
  const max = b.maximum != null ? b.maximum : '?';
  return `${cur}/${max}`;
}

function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s <= 0) return 'Ready';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const GAIN_WATCH_FILE = '/opt/discord-bot/gain-watch.json';
let gainWatch = {};
let gainClient = null;

function loadGainWatch() {
  try { if (fs.existsSync(GAIN_WATCH_FILE)) gainWatch = JSON.parse(fs.readFileSync(GAIN_WATCH_FILE, 'utf8')); } catch (e) { gainWatch = {}; }
  if (!gainWatch || typeof gainWatch !== 'object') gainWatch = {};
}
function saveGainWatch() {
  try { fs.writeFileSync(GAIN_WATCH_FILE, JSON.stringify(gainWatch)); } catch (e) {}
}

let eduNamesCache = null;
async function loadCourseNames() {
  if (eduNamesCache) return eduNamesCache;
  try {
    const d = await tornGet('torn', '', 'education', 1, TORN_API_KEY, { cacheTtl: 86400, retries: 1 });
    const names = {};
    for (const [id, c] of Object.entries(d.education || {})) names[id] = c.name;
    eduNamesCache = names;
  } catch (e) {
    eduNamesCache = {};
  }
  return eduNamesCache;
}
function courseNameFor(id, names) {
  return (names && names[String(id)]) || `course #${id}`;
}

function startGainMonitor(client) {
  gainClient = client;
  loadGainWatch();
  console.log(`[discord-bot] gain reminders enabled (${Object.keys(gainWatch).length} subscriber(s))`);
  setInterval(pollGainWatch, 120000);
}

async function pollGainWatch() {
  if (!gainClient) return;
  const uids = Object.keys(gainWatch);
  if (!uids.length) return;
  for (const uid of uids) {
    const account = accountStore.getAccount(uid);
    const apiKey = account ? accountStore.getApiKey(uid) : null;
    if (!apiKey) continue;
    let d;
    try { d = await tornGet('user', '', 'bars,cooldowns,education,money', 1, apiKey); } catch (e) { continue; }
    const sub = gainWatch[uid] || { energy: false, nerve: false };
    const msgs = [];
    if (d.energy && d.energy.current != null && d.energy.maximum != null) {
      const full = d.energy.current >= d.energy.maximum;
      if (full && !sub.energy) msgs.push(`\u26A1 Energy full (${d.energy.current}/${d.energy.maximum}) \u2014 go train or attack!`);
      sub.energy = full;
    }
    if (d.nerve && d.nerve.current != null && d.nerve.maximum != null) {
      const full = d.nerve.current >= d.nerve.maximum;
      if (full && !sub.nerve) msgs.push(`\u{1F9E9} Nerve full (${d.nerve.current}/${d.nerve.maximum}) \u2014 go do crimes!`);
      sub.nerve = full;
    }
    const eduRunning = d.education_timeleft != null && Number(d.education_timeleft) > 0;
    if (eduRunning) {
      sub.educationHad = true;
      sub.educationAlerted = false;
      const names = await loadCourseNames();
      sub.educationName = courseNameFor(d.education_current, names);
    } else if (sub.educationHad && !sub.educationAlerted) {
      msgs.push(`\u{1F393} **Course complete** \u2014 ${sub.educationName || 'your course'} is done. Start the next course!`);
      sub.educationAlerted = true;
      sub.educationHad = false;
    }
    const bankRunning = d.city_bank && Number(d.city_bank.time_left) > 0;
    if (bankRunning) {
      sub.bankHad = true;
      sub.bankAlerted = false;
    } else if (sub.bankHad && !sub.bankAlerted) {
      msgs.push(`\u{1F4B3} **Bank investment complete** \u2014 collect the payout and start a new investment!`);
      sub.bankAlerted = true;
      sub.bankHad = false;
    }
    if (msgs.length) {
      try {
        const user = await gainClient.users.fetch(uid);
        if (user) await user.send(`\u{1F514} **Timer reminder**\n${msgs.join('\n')}`);
      } catch (e) {
        console.error(`[gain] DM failed for ${uid}:`, e.message);
      }
    }
    gainWatch[uid] = sub;
    saveGainWatch();
  }
}

async function handleGain(message, args) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }

  const cmd = (args[0] || '').toLowerCase();
  if (cmd === 'on' || cmd === 'watch') {
    loadGainWatch();
    const sub = { energy: false, nerve: false, educationHad: false, educationAlerted: false, bankHad: false, bankAlerted: false };
    try {
      const d = await tornGet('user', '', 'bars,cooldowns,education,money', 1, apiKey);
      if (d.energy) sub.energy = d.energy.current >= d.energy.maximum;
      if (d.nerve) sub.nerve = d.nerve.current >= d.nerve.maximum;
      if (d.education_timeleft != null && Number(d.education_timeleft) > 0) sub.educationHad = true;
      if (d.city_bank && Number(d.city_bank.time_left) > 0) sub.bankHad = true;
    } catch (e) {}
    gainWatch[userId] = sub;
    saveGainWatch();
    await message.reply('\u{1F514} **Timer reminders ON** \u2014 I\'ll DM you the moment your Energy or Nerve fills up, your course completes, or your bank investment matures. `!gain off` to stop.');
    return;
  }
  if (cmd === 'off' || cmd === 'unwatch') {
    loadGainWatch();
    if (gainWatch[userId]) { delete gainWatch[userId]; saveGainWatch(); }
    await message.reply('Timer reminders OFF.');
    return;
  }
  if (cmd === 'status') {
    loadGainWatch();
    await message.reply(gainWatch[userId] ? 'Timer reminders are **ON** \u2014 I\'ll DM you when Energy/Nerve fills, a course completes, or a bank investment matures.' : 'Timer reminders are OFF. Use `!gain on` to start.');
    return;
  }

  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', '', 'bars,cooldowns', 1, apiKey);
    const lines = [`\u{1F50B} **${account.tornUsername}** — Energy / Nerve Planner`];
    const addBar = (label, emoji, b) => {
      if (!b) return;
      const cur = b.current != null ? b.current : 0;
      const max = b.maximum != null ? b.maximum : cur;
      const missing = max - cur;
      const inc = b.increment;
      const interval = b.interval;
      if (!inc || !interval || missing <= 0) {
        lines.push(`${emoji} ${label}: **${cur}/${max}**`);
        return;
      }
      const tillFull = Math.ceil(missing / inc) * interval;
      lines.push(`${emoji} ${label}: **${cur}/${max}** +${inc} every ${interval}s \u2192 full in **${fmtTime(tillFull)}**`);
    };
    addBar('Energy', '\u26A1', d.energy);
    addBar('Nerve', '\u{1F9E9}', d.nerve);
    addBar('Happy', '\u{1F604}', d.happy);
    if (d.cooldowns) {
      const cd = [];
      for (const k of ['drug', 'medical', 'booster']) {
        if (d.cooldowns[k] != null && d.cooldowns[k] > 0) cd.push(`${k}: ${fmtTime(d.cooldowns[k])}`);
      }
      if (cd.length) lines.push(`\u23F1\uFE0F Cooldowns \u2014 ${cd.join('  \u2022  ')}`);
    }
    lines.push('');
    lines.push('Tip: set a reminder at ~90% so you never waste regen \u2014 run \u2018!levelpacer\u2019 to check your pace.');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleTimers(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', '', 'bars,cooldowns,education,money', 1, apiKey);
    const lines = [`\u23F1\uFE0F **${account.tornUsername}** \u2014 Timers`];
    const addBar = (label, emoji, b) => {
      if (!b) return;
      const cur = b.current != null ? b.current : 0;
      const max = b.maximum != null ? b.maximum : cur;
      const missing = max - cur;
      const inc = b.increment;
      const interval = b.interval;
      if (!inc || !interval || missing <= 0) {
        lines.push(`${emoji} ${label}: **${cur}/${max}**`);
        return;
      }
      lines.push(`${emoji} ${label}: **${cur}/${max}** \u2192 full in **${fmtTime(Math.ceil(missing / inc) * interval)}**`);
    };
    addBar('Energy', '\u26A1', d.energy);
    addBar('Nerve', '\u{1F9E9}', d.nerve);
    addBar('Happy', '\u{1F604}', d.happy);
    if (d.cooldowns) {
      const cd = [];
      for (const k of ['drug', 'medical', 'booster']) {
        if (d.cooldowns[k] != null && d.cooldowns[k] > 0) cd.push(`${k}: ${fmtTime(d.cooldowns[k])}`);
      }
      if (cd.length) lines.push(`\u23F1\uFE0F Cooldowns \u2014 ${cd.join('  \u2022  ')}`);
    }
    if (d.education_current != null && Number(d.education_timeleft) > 0) {
      const names = await loadCourseNames();
      lines.push(`\u{1F393} Course: **${courseNameFor(d.education_current, names)}** \u2014 ${fmtTime(d.education_timeleft)} left`);
    } else {
      lines.push(`\u{1F393} Course: none running \u2014 start one with a course from *!courses*`);
    }
    if (d.city_bank && Number(d.city_bank.time_left) > 0) {
      lines.push(`\u{1F4B3} Bank investment: **$${shortMoney(d.city_bank.amount)}** \u2014 ${fmtTime(d.city_bank.time_left)} left`);
    } else {
      lines.push(`\u{1F4B3} Bank investment: none running \u2014 deposit with *!bank balance* advice`);
    }
    lines.push('');
    lines.push('Tip: run `!gain on` to get a DM the moment any of these completes.');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

function crimeTier(level) {
  if (level <= 2) return { crime: 'Shoplifting', min: 1, tip: 'near-zero risk, best XP at your level' };
  if (level <= 4) return { crime: 'Robbery', min: 2, tip: 'medium risk, solid XP' };
  if (level <= 6) return { crime: 'Burglary', min: 3, tip: 'pays better, still low prison risk' };
  if (level <= 9) return { crime: 'Theft', min: 4, tip: 'good XP and cash' };
  if (level <= 13) return { crime: 'Hustling', min: 5, tip: 'best mid-game XP' };
  return { crime: 'Cracking', min: 6, tip: 'high-tier crimes for big xp' };
}

async function handleCrimeRoute(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', '', 'profile,battlestats,bars', 1, apiKey);
    const level = d.level || 1;
    const tier = crimeTier(level);
    const total = d.total || ((d.strength || 0) + (d.defense || 0) + (d.speed || 0) + (d.dexterity || 0));
    const nerve = d.nerve;
    const lines = [];
    lines.push(`\u{1F3AF} **${account.tornUsername}** — Crime Route (level ${level}, ${fmt(total)} stats)`);
    lines.push(`\u25B6 **Best crime now: ${tier.crime}** \u2014 ${tier.tip}.`);
    lines.push(`\u{1F4A1} Grind a crime that matches your level for max XP-per-energy. Don\u2019t grind way below (wasted XP) or way above (jail).`);
    if (nerve) {
      lines.push(`\u{1F9E9} Nerve: ${nerve.current}/${nerve.maximum} \u2014 crimes consume nerve, so bank it when chains are coming.`);
    }
    if (total < 200) {
      lines.push(`\u{1F4AA} Push **Nerve Bar + Crime Success** stats first \u2014 they cut fails and stretch every refill.`);
    }
    lines.push(`\u{1F511} Run \u2018!gain\u2019 to time your refills, and re-check this route as you level.`);
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function handleFlipCalc(message, args) {
  const reply = await message.reply('Calculating\u2026');
  try {
    const q = (args[0] || '').trim();
    const qtyStr = (args[1] || '').trim();
    const buyStr = (args[2] || '').trim();
    const sellStr = (args[3] || '').trim();
    if (!q || !qtyStr || !buyStr) {
      await reply.edit('Usage: `!flipcalc <item> <qty> <buy> [sell]` \u2014 e.g. `!flipcalc Xanax 500 880000 915000`');
      return;
    }
    const qty = Number(qtyStr.replace(/[,km]/gi, ''));
    const buy = Number(buyStr.replace(/,/g, ''));
    if (!qty || !buy || qty <= 0 || buy <= 0) {
      await reply.edit('Invalid quantity or price. Use whole numbers, e.g. `!flipcalc Xanax 500 880000`');
      return;
    }
    let sell = sellStr ? Number(sellStr.replace(/,/g, '')) : null;
    let sellNote = '';
    if (!sell) {
      const rec = await findWatchedItem(q);
      if (rec) {
        const st = robustStats(rec);
        if (st) sell = st.high;
        sellNote = ` (auto: realistic high $${fmt(sell)})`;
      }
    }
    if (!sell || sell <= 0) {
      await reply.edit('No sell price. Pass one: `!flipcalc Xanax 500 880000 915000`');
      return;
    }
    const cost = qty * buy;
    const gross = qty * sell;
    const fee = gross * SELL_FEE;
    const net = gross - fee;
    const profit = net - cost;
    const marginPct = cost > 0 ? (profit / cost) * 100 : 0;
    const lines = [];
    lines.push(`\u{1F4B0} **Flip Calculator** \u2014 ${q} \u00D7${fmt(qty)}`);
    lines.push(`Buy: **$${fmt(buy)}** \u00D7 ${fmt(qty)} = **$${fmt(cost)}**`);
    lines.push(`Sell: **$${fmt(sell)}** \u00D7 ${fmt(qty)} = **$${fmt(gross)}**`);
    lines.push(`\u00D7 ${SELL_FEE * 100}% fee: **\u2212$${fmt(Math.round(fee))}**`);
    lines.push(`Profit: **${profit >= 0 ? '+' : '\u2212'}$${fmt(Math.round(Math.abs(profit)))}** (${marginPct >= 0 ? '+' : ''}${marginPct.toFixed(1)}%)`);
    if (sellNote) lines.push(`*${sellNote}*)`);
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function findWatchedItem(q) {
  const lower = q.toLowerCase();
  for (const id of priceData.watchlist) {
    const rec = priceData.items[id];
    if (rec && (rec.name || '').toLowerCase() === lower) return rec;
  }
  for (const id of priceData.watchlist) {
    const rec = priceData.items[id];
    if (rec && (rec.name || '').toLowerCase().includes(lower)) return rec;
  }
  return null;
}

async function handleLevelPacer(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    const d = await tornGet('user', '', 'profile,battlestats,bars', 1, apiKey);
    const level = d.level || 1;
    const energy = d.energy || {};
    const cur = energy.current != null ? energy.current : 0;
    const max = energy.maximum != null ? energy.maximum : 100;
    const missing = Math.max(0, max - cur);
    const fullIn = Math.ceil(missing / (energy.increment || 1)) * (energy.interval || 300);
    const tier = crimeTier(level);
    const lines = [];
    lines.push(`\u{1F4C8} **${account.tornUsername}** — Level Pacer (level ${level})`);
    lines.push(`\u26A1 Energy ${cur}/${max} \u2014 full in **${fmtTime(fullIn)}**.`);
    if (energy.increment && energy.interval) {
      lines.push(`\u{1F4E2} Next +${energy.increment} gain in ~**${fmtTime(energy.interval || 300)}** \u2014 check \u2018!gain\u2019 for the full schedule.`);
    }
    lines.push(`\u{1F3AF} Grind **${tier.crime}** \u2014 each level-up refills energy instantly, so chain crimes back-to-back.`);
    if (level < 15) {
      lines.push(`\u26A0\uFE0F Rough rule: \u2018Watchman\u2019 (+50% XP) is buyable ~level 5+ when you have \u2248$60k \u2014 it roughly doubles your pace.`);
      lines.push(`\u{1F3C6} Active play \u2192 **level 15 in ~1\u20132 weeks** (unlocks travel flips & real money).`);
    } else {
      lines.push(`\u2708\uFE0F Travel unlocked. Grid your energy toward **plushie/flower runs \u2192 Museum Points** for reliable income, and use \u2018!stock\u2019/\u2018!crime\u2019 to plan.`);
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

function jobEligibility(level) {
  const jobs = [
    { name: 'Grocer', min: 1, max: 2, pay: 'low', note: 'starter job, keep for the salary streak' },
    { name: 'Casino', min: 3, max: 6, pay: 'low-mid', note: 'easy promotion path, safe' },
    { name: 'Education', min: 3, max: 6, pay: 'low-mid', note: 'passive, good stepping stone' },
    { name: 'Army', min: 10, max: 20, pay: 'high', note: 'great pay + gives free stats' },
    { name: 'Law', min: 10, max: 20, pay: 'high', note: 'high salary, steady' },
    { name: 'Medical', min: 15, max: 30, pay: 'mid', note: 'good for healing/med supplies' },
  ];
  const current = jobs.filter((j) => level >= j.min && level <= j.max);
  const next = jobs.filter((j) => level < j.min).sort((a, b) => a.min - b.min);
  return { current, next };
}

async function handleJobApply(message, arg) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }
  const reply = await message.reply('Fetching\u2026');
  try {
    let level = null;
    let job = null;
    if (arg) {
      const cand = INTERVIEW[arg.toLowerCase().trim()];
      if (cand) {
        job = cand;
      } else {
        await reply.edit(`Unknown job "${arg}". Try: ${Object.keys(INTERVIEW).join(', ')}`);
        return;
      }
    }
    if (!level) {
      try {
        const d = await tornGet('user', '', 'profile', 1, apiKey);
        level = d.level || null;
        if (job == null && d.job && d.job.job) job = INTERVIEW[d.job.job.toLowerCase()];
      } catch (e) {}
    }
    const lines = [];
    lines.push(`\u{1F4BC} **${account.tornUsername}** — Job Finder`);
    if (job) {
      lines.push(`**${job.name} interview — quick answers**`);
      for (const [q, a] of job.qa.slice(0, 5)) lines.push(`\u2022 ${q} \u2192 **${a}**`);
      lines.push(`...full set (${job.qa.length} Qs): \`!interview ${arg || job.name.toLowerCase()}\``);
    } else {
      if (level) {
        const { current, next } = jobEligibility(level);
        if (current.length) {
          lines.push(`\u2705 **You qualify for:**`);
          for (const j of current) lines.push(`\u2022 **${j.name}** (${j.pay}) \u2014 ${j.note}`);
        }
        if (next.length) {
          lines.push(`\u{1F513} **Unlocks later (level ${next[0].min}+):**`);
          for (const j of next.slice(0, 3)) lines.push(`\u2022 **${j.name}** (${j.pay}) \u2014 ${j.note}`);
        }
      } else {
        lines.push('Couldn\u2019t read your level \u2014 run \u2018!job-apply <job>\u2019 to get a job\u2019s interview answers.');
      }
    }
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

async function sendDailyDigest(message) {
  await updatePriceBoard();
  if (message) {
    await message.reply('\u{1F4CA} Price board refreshed \u2014 watch the linked list for live buy/sell signals.');
  }
}

function startDailyDigest() {
  if (!BOARD_CHANNEL_IDS) {
    console.log('[discord-bot] daily board refresh disabled (missing BOARD_CHANNEL_IDS)');
    return;
  }
  console.log('[discord-bot] daily board refresh scheduled');
  const run = () => { updatePriceBoard().catch((e) => console.error('[discord-bot] board refresh failed:', e.message)); };
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const waitMs = next - now;
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, waitMs);
}

function networthTotal(d) {
  if (!d.networth) return null;
  if (typeof d.networth === 'number') return d.networth;
  if (d.networth.total != null) return d.networth.total;
  if (d.networth.networth != null) return typeof d.networth.networth === 'number' ? d.networth.networth : d.networth.networth.total;
  return null;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

function fmtSeconds(s) {
  const n = Number(s) || 0;
  if (n <= 0) return 'Ready';
  const m = Math.floor(n / 60);
  const sec = n % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// --- Chain monitor ---

let chainState = { active: false, lastCount: 0, initialized: false };
const CHAIN_START_HITS = 10;
const CHAIN_MILESTONES = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function startChainMonitor() {
  if (!FACTION_ID || !CHAIN_CHANNEL_ID) {
    console.log('[discord-bot] chain monitor disabled (missing FACTION_ID or CHAIN_CHANNEL_ID)');
    return;
  }
  console.log(`[discord-bot] chain monitor enabled for faction ${FACTION_ID}`);
  pollChain();
  setInterval(pollChain, 30000);
}

async function pollChain() {
  try {
    const d = await tornGet('faction', FACTION_ID, 'chain');
    const chain = d.chain || {};
    const current = Number(chain.current) || 0;
    if (!chainState.initialized) {
      chainState.initialized = true;
      chainState.active = current >= CHAIN_START_HITS;
      chainState.lastCount = current;
      return;
    }
    if (current >= CHAIN_START_HITS && !chainState.active) {
      chainState.active = true;
      chainState.lastCount = current;
      await announce(`\u{1F517} **Chain started!** ${current} hit${current === 1 ? '' : 's'} and counting.`);
    } else if (current > 0 && chainState.active) {
      for (const m of CHAIN_MILESTONES) {
        if (current >= m && chainState.lastCount < m) {
          await announce(`\u26A1 Chain at **${m}** hits!`);
        }
      }
      chainState.lastCount = current;
    } else if (current === 0 && chainState.active) {
      await announce(`\u2705 **Chain ended** \u2014 final: ${chainState.lastCount} hit${chainState.lastCount === 1 ? '' : 's'}.`);
      chainState.active = false;
      chainState.lastCount = 0;
    }
  } catch (e) {
    // transient API errors — ignore
  }
}

async function announce(text) {
  try {
    const channel = await client.channels.fetch(CHAIN_CHANNEL_ID);
    if (channel && channel.send) await channel.send(text);
  } catch (e) {
    console.error('[discord-bot] chain announce failed:', e.message);
  }
}

// --- War monitor ---

let warMonitorInit = false;
let knownWars = {};
const WARS_FILE = '/opt/discord-bot/wars.json';

function loadKnownWars() {
  try {
    if (fs.existsSync(WARS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WARS_FILE, 'utf8'));
      knownWars = parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (e) {
    knownWars = {};
  }
}

function saveKnownWars() {
  try {
    fs.writeFileSync(WARS_FILE, JSON.stringify(knownWars));
  } catch (e) {
    console.error('[discord-bot] saveKnownWars failed:', e.message);
  }
}

function startWarMonitor() {
  if (!FACTION_ID || !WAR_CHANNEL_ID) {
    console.log('[discord-bot] war monitor disabled (missing FACTION_ID or WAR_CHANNEL_ID)');
    return;
  }
  loadKnownWars();
  console.log(`[discord-bot] war monitor enabled for faction ${FACTION_ID} (${Object.keys(knownWars).length} known wars)`);
  pollWars();
  setInterval(pollWars, 300000);
}

async function sendToWarRoom(text) {
  if (!WAR_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(WAR_CHANNEL_ID);
    if (channel && channel.send) await channel.send(text);
  } catch (e) {
    console.error('[discord-bot] war announce failed:', e.message);
  }
}

async function pollWars() {
  try {
    const d = await tornGet('faction', FACTION_ID, 'rankedwars');
    const wars = d.rankedwars || {};
    let changed = false;
    for (const [warId, war] of Object.entries(wars)) {
      if (warMonitorInit && !knownWars[warId]) {
        const factions = Object.entries(war.factions || {}).map(([fid, f]) => ({ id: String(fid), name: f.name, score: f.score }));
        const winnerId = war.war && war.war.winner != null ? String(war.war.winner) : null;
        const winner = factions.find((f) => f.id === winnerId);
        const lines = ['\u{1F3C6} **Ranked war ended**'];
        lines.push(factions.map((f) => `${f.name}: **${fmt(f.score)}**${f.id === winnerId ? ' \u{1F947}' : ''}`).join('  vs  '));
        if (winner) lines.push(`\u{1F3C6} Winner: **${winner.name}**`);
        await sendToWarRoom(lines.join('\n'));
      }
      if (!knownWars[warId]) changed = true;
      knownWars[warId] = true;
    }
    if (changed) saveKnownWars();
  } catch (e) {
    // transient — ignore
  }
  warMonitorInit = true;
}

// --- Price watcher ---

let priceData = { watchlist: [], inactive: [], items: {}, boards: {}, alertSubs: {}, guideSubs: {}, digestMsgId: null };
let lastSignals = {};
let lastSignalAlertAt = {};

const LINKS_FILE = '/opt/discord-bot/links.json';
let links = {};

function loadLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch (e) {
    console.error('[discord-bot] loadLinks failed:', e.message);
  }
}

function saveLinks() {
  try {
    fs.writeFileSync(LINKS_FILE, JSON.stringify(links));
  } catch (e) {
    console.error('[discord-bot] saveLinks failed:', e.message);
  }
}

let ownerId = null;
async function getOwnerId() {
  if (ownerId) return ownerId;
  try {
    const d = await tornGet('user', '', 'basic');
    ownerId = String(d.player_id);
  } catch (e) {}
  return ownerId;
}

function loadPrices() {
  try {
    if (fs.existsSync(PRICES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
      let alertSubs = parsed.alertSubs || {};
      let guideSubs = parsed.guideSubs || {};
      if (parsed.alertSub && typeof parsed.alertSub === 'string' && !alertSubs[parsed.alertSub]) {
        alertSubs[parsed.alertSub] = { green: (parsed.alerted && parsed.alerted.green) || {}, msg: (parsed.alerted && parsed.alerted.msg) || null };
      }
      if (parsed.guideSub && typeof parsed.guideSub === 'string' && !guideSubs[parsed.guideSub]) {
        guideSubs[parsed.guideSub] = { msg: parsed.guideMsg || null };
      }
      priceData = { watchlist: parsed.watchlist || [], inactive: parsed.inactive || [], items: parsed.items || {}, boards: parsed.boards || {}, alertSubs: alertSubs, guideSubs: guideSubs, digestMsgId: parsed.digestMsgId || null };
    }
  } catch (e) {
    console.error('[discord-bot] loadPrices failed:', e.message);
  }
}

function savePrices() {
  try {
    fs.writeFileSync(PRICES_FILE, JSON.stringify(priceData));
  } catch (e) {
    console.error('[discord-bot] savePrices failed:', e.message);
  }
}

function recordPrice(id, price, qty) {
  if (!priceData.items[id]) {
    priceData.items[id] = { name: `#${id}`, allTimeHigh: null, allTimeLow: null, history: [] };
  }
  const rec = priceData.items[id];
  const now = Math.floor(Date.now() / 1000);
  rec.history.push({ t: now, p: price, q: qty != null ? qty : 0 });
  if (rec.history.length > HISTORY_LIMIT) rec.history.shift();
  if (!rec.allTimeHigh || price > rec.allTimeHigh.price) rec.allTimeHigh = { price, at: now };
  if (!rec.allTimeLow || price < rec.allTimeLow.price) rec.allTimeLow = { price, at: now };
}

async function ensureDefaultWatchlist() {
  if (priceData.watchlist.length || Object.keys(priceData.items).length) return;
  try {
    const items = await getItemsCache();
    for (const name of DEFAULT_WATCH) {
      const found = Object.entries(items).find(([, it]) => (it.name || '').toLowerCase() === name.toLowerCase());
      if (found) {
        priceData.watchlist.push(found[0]);
        priceData.items[found[0]] = { name: found[1].name, allTimeHigh: null, allTimeLow: null, history: [] };
      }
    }
    savePrices();
    console.log(`[discord-bot] seeded default watchlist: ${priceData.watchlist.length} items`);
  } catch (e) {
    console.error('[discord-bot] seed watchlist failed:', e.message);
  }
}

async function startPriceWatcher() {
  loadPrices();
  await ensureDefaultWatchlist();
  console.log(`[discord-bot] price watcher started (${priceData.watchlist.length} items, dual-key 40s/20s offset)`);
  pollPrices(0, 0);
  setTimeout(() => pollPrices(1, 1), 20000);
  setInterval(() => pollPrices(0, 0), 40000);
  setInterval(() => pollPrices(1, 1), 40000);
  pollInactive();
  setInterval(pollInactive, 300000);
}

function priceGroup(id) {
  let s = 0;
  for (const ch of String(id)) s += ch.charCodeAt(0);
  return s % 2 === 1 ? 1 : 0;
}

async function handleAlert(message, rest) {
  const arg = (rest || '').trim().toLowerCase();
  const uid = message.author.id;
  if (arg === 'on') {
    priceData.alertSubs = priceData.alertSubs || {};
    priceData.alertSubs[uid] = { green: {}, msg: null };
    savePrices();
    await message.author.send('\u{1F4EC} **Buy alerts: ON** \u2014 I\u2019ll DM you a live list of watched items that are in the **green** (buy dips), and keep the same message updated as the list changes. Use `!alert off` to stop.');
    await message.reply('\u{1F4EC} Buy alerts ON \u2014 I\u2019ll DM you a live green-dot list. Check your DMs.');
  } else if (arg === 'off') {
    if (priceData.alertSubs && priceData.alertSubs[uid]) {
      delete priceData.alertSubs[uid];
      savePrices();
      await message.reply('Your alerts are now OFF.');
    } else {
      await message.reply('Alerts aren\u2019t on for you. Use `!alert on` to start.');
    }
  } else if (arg === 'status') {
    if (priceData.alertSubs && priceData.alertSubs[uid]) {
      await message.reply(`Buy alerts ON for you \u2014 I\u2019ll DM your live green list.`);
    } else {
      await message.reply('Your buy-alerts are OFF. Use `!alert on` to get buy-dip DMs.');
    }
  } else {
    await message.reply('Usage: `!alert on` / `!alert off` / `!alert status`.');
  }
}

async function handleBulk(message) {
  const userId = message.author.id;
  try {
    const data = await tornGet('torn', '', 'cityshops');
    const shops = data.cityshops || {};
    const itemMap = {};
    for (const shopId in shops) {
      const shop = shops[shopId];
      if (!shop || !shop.inventory) continue;
      for (const itemId in shop.inventory) {
        const item = shop.inventory[itemId];
        if (!item) continue;
        const name = item.name || `Unknown #${itemId}`;
        const price = item.price || 0;
        const stock = item.in_stock || 0;
        if (!itemMap[name]) {
          itemMap[name] = { price, stock: 0 };
        }
        itemMap[name].stock += stock;
        if (price < itemMap[name].price) itemMap[name].price = price;
      }
    }
    const bulkItems = [];
    for (const [name, info] of Object.entries(itemMap)) {
      if (info.stock >= 100) {
        bulkItems.push({ name, price: info.price, stock: info.stock });
      }
    }
    bulkItems.sort((a, b) => b.stock - a.stock);
    if (bulkItems.length === 0) {
      await message.reply('No items in Torn City shops have at least 100 units in stock.');
      return;
    }
    const lines = [];
    lines.push('**Items with >=100 stock in Torn City shops:**');
    for (const item of bulkItems.slice(0, 20)) {
      lines.push(`• **${item.name}** - Price: $${item.price.toLocaleString()} - Stock: ${item.stock.toLocaleString()}`);
    }
    await message.reply(lines.join('\n'));
  } catch (e) {
    console.error('[discord-bot] handleBulk error:', e);
    await message.reply(`❌ Error fetching shop data: ${e.message}`);
  }
}

async function handleClear(message, args) {
  if (!message.guild) return;
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'all') {
    const deleted = await clearRequesterMessages(message);
    const confirm = await message.channel.send(`\u{1F9F9} Cleared ${deleted} of your message(s).`).catch(() => null);
    if (confirm) setTimeout(() => confirm.delete().catch(() => {}), 5000);
    return;
  }

  const channel = message.channel;
  const channelId = channel.id;
  const boardIds = new Set((priceData.boards && priceData.boards[channelId]) || []);
  const toDelete = new Set();
  if (message.deletable) toDelete.add(message.id);
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    for (const m of fetched.values()) {
      if (boardIds.has(m.id)) continue;
      if (m.author && m.author.id === client.user.id && m.deletable) toDelete.add(m.id);
    }
  } catch (e) {
    return;
  }
  if (!toDelete.size) return;
  const ids = [...toDelete];
  try {
    if (ids.length === 1) {
      const m = await channel.messages.fetch(ids[0]).catch(() => null);
      if (m) await m.delete();
    } else if (channel.bulkDelete) {
      await channel.bulkDelete(ids, true).catch(() => {});
    } else {
      for (const id of ids) {
        const m = await channel.messages.fetch(id).catch(() => null);
        if (m) await m.delete().catch(() => {});
      }
    }
  } catch (e) {
    return;
  }
}

async function clearRequesterMessages(message) {
  const channel = message.channel;
  const authorId = message.author.id;
  const now = Date.now();
  const CUTOFF = 14 * 24 * 60 * 60 * 1000;
  let total = 0;
  let lastId = null;

  for (let pass = 0; pass < 20; pass++) {
    let fetched;
    try {
      fetched = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    } catch (e) { break; }
    if (!fetched || fetched.size === 0) break;

    const mine = fetched.filter((m) => m.author && m.author.id === authorId);
    const bulk = [];
    const old = [];
    for (const m of mine.values()) {
      if (now - m.createdTimestamp < CUTOFF) bulk.push(m.id);
      else old.push(m.id);
    }
    if (bulk.length) {
      try {
        await channel.bulkDelete(bulk, true);
        total += bulk.length;
      } catch (e) {
        for (const id of bulk) {
          const m = await channel.messages.fetch(id).catch(() => null);
          if (m) { await m.delete().catch(() => {}); total++; }
        }
      }
    }
    for (const id of old) {
      const m = await channel.messages.fetch(id).catch(() => null);
      if (m) { await m.delete().catch(() => {}); total++; }
    }

    if (fetched.size < 100) break;
    lastId = fetched.last().id;
  }
  return total;
}

function buildGreenList() {
  const greens = [];
  for (const id of priceData.watchlist) {
    const rec = priceData.items[id];
    if (!rec || rec.history.length < ALERT_MIN_HISTORY) continue;
    const sig = computeSignal(rec);
    if (sig && sig.signal === 'buy' && sig.marginPct > 0) {
      greens.push({ id, name: rec.name, sig });
    }
  }
  greens.sort((a, b) => b.sig.marginPct - a.sig.marginPct);
  return greens;
}

function buildGreenEmbed(greens) {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (!greens.length) {
    return {
      title: '\u{1F7E2} GREEN DOTS',
      description: 'None right now.',
      color: 0x95a5a6,
      footer: { text: `Updated ${time} \u00B7 auto-refreshes as the list changes` },
    };
  }
  const lines = greens.map((g) =>
    `\u2022 [**${g.name}**](${itemMarketUrl(g.id, g.name)}) \u2014 buy $${fmt(g.sig.current)} \u2192 sell $${fmt(g.sig.high)} (**+${g.sig.marginPct.toFixed(1)}%** after 5% fee)`
  );
  return {
    title: `\u{1F7E2} GREEN DOTS (${greens.length}) \u2014 buy the dip, resell at the 24h high`,
    description: lines.join('\n'),
    color: 0x2ecc71,
    footer: { text: `Updated ${time} \u00B7 auto-refreshes as the list changes` },
  };
}

async function scanAndAlert() {
  const subs = priceData.alertSubs || {};
  const uids = Object.keys(subs);
  if (!uids.length) return;
  const greens = buildGreenList();
  const newSet = {};
  for (const g of greens) newSet[g.id] = true;

  for (const uid of uids) {
    const entry = subs[uid] || {};
    const cur = entry.green || {};
    const same =
      Object.keys(newSet).length === Object.keys(cur).length &&
      Object.keys(newSet).every((k) => cur[k]);
    if (same && entry.msg) continue;

    const embed = buildGreenEmbed(greens);

    entry.green = newSet;
    savePrices();

    try {
      const user = await client.users.fetch(uid);
      if (!user) continue;
      if (entry.msg) {
        let ok = false;
        try {
          const channel = await client.channels.fetch(entry.msg.channelId);
          const m = await channel.messages.fetch(entry.msg.messageId);
          await m.edit({ embeds: [embed] });
          ok = true;
        } catch (e) {
          entry.msg = null;
        }
        if (ok) {
          savePrices();
          continue;
        }
      }
      if (greens.length) {
        const dm = await user.send({ embeds: [embed] });
        entry.msg = { channelId: dm.channelId, messageId: dm.id };
        savePrices();
      }
    } catch (e) {
      console.error(`[discord-bot] alert DM failed for ${uid}:`, e.message);
    }
  }
}

function listingsSig(im, listings) {
  const avg = im.item && im.item.average_price != null ? im.item.average_price : 0;
  return `${avg}|` + listings.map((l) => `${l.price}:${l.amount}`).sort().join(',');
}

async function pollPrices(groupIdx = 0, keyIndex = 0) {
  const nowActive = [...priceData.watchlist].filter((id) => priceGroup(id) === groupIdx);
  await Promise.allSettled(nowActive.map(async (id) => {
    try {
      const d = await tornGet('market', id, 'itemmarket', 2, keyIndex);
      const im = d.itemmarket || {};
      const listings = (im.listings || []).map((l) => ({ price: Number(l.price) || 0, amount: Number(l.amount) || 0 })).filter((l) => l.price > 0);
      const rec = priceData.items[id];
      if (!rec) return;
      const sig = listings.length ? listingsSig(im, listings) : null;
      if (listings.length) {
        const minPrice = Math.min(...listings.map((l) => l.price));
        const qty = listings.filter((l) => l.price === minPrice).reduce((s, l) => s + l.amount, 0);
        recordPrice(id, minPrice, qty);
      }
      if (rec.lastSig === sig) {
        rec.staleCount = (rec.staleCount || 0) + 1;
        if (rec.staleCount >= SELL_STALE_POLLS) {
          priceData.watchlist = priceData.watchlist.filter((x) => x !== id);
          if (!priceData.inactive.includes(id)) priceData.inactive.push(id);
          rec.staleCount = 0;
          console.log(`[discord-bot] ${rec.name} removed (not selling)`);
        }
      } else {
        rec.staleCount = 0;
      }
      rec.lastSig = sig;
    } catch (e) {
      // transient errors — skip
    }
  }));
  savePrices();
  await updatePriceBoard();
  await updateMembersBoard();
  await scanAndAlert();
}

async function pollInactive() {
  if (!priceData.inactive.length) return;
  const nowInactive = [...priceData.inactive];
  await Promise.allSettled(nowInactive.map(async (id) => {
    try {
      const d = await tornGet('market', id, 'itemmarket', 2);
      const im = d.itemmarket || {};
      const listings = (im.listings || []).map((l) => ({ price: Number(l.price) || 0, amount: Number(l.amount) || 0 })).filter((l) => l.price > 0);
      const rec = priceData.items[id];
      if (!rec) {
        priceData.inactive = priceData.inactive.filter((x) => x !== id);
        return;
      }
      const sig = listings.length ? listingsSig(im, listings) : null;
      if (sig && sig !== rec.lastSig) {
        priceData.watchlist.push(id);
        priceData.inactive = priceData.inactive.filter((x) => x !== id);
        rec.lastSig = sig;
        rec.staleCount = 0;
        if (listings.length) {
          const minPrice = Math.min(...listings.map((l) => l.price));
          const qty = listings.filter((l) => l.price === minPrice).reduce((s, l) => s + l.amount, 0);
          recordPrice(id, minPrice, qty);
        }
        console.log(`[discord-bot] ${rec.name} re-added (selling again)`);
      }
    } catch (e) {
      // transient errors — skip
    }
  }));
  savePrices();
}

function shortMoney(n) {
  n = Number(n);
  const f = (v, s) => v.toFixed(1).replace(/\.0$/, '') + s;
  if (n >= 1e9) return f(n / 1e9, 'b');
  if (n >= 1e6) return f(n / 1e6, 'm');
  if (n >= 1e3) return f(n / 1e3, 'k');
  return String(n);
}

function changeMark(current, prev) {
  if (prev == null || prev === 0) return '0%';
  const pct = (current - prev) / prev * 100;
  if (Math.abs(pct) < 0.05) return '0%';
  if (pct > 0) return `\u{1F7E9}+${pct.toFixed(1)}%`;
  return `\u{1F7E5}${pct.toFixed(1)}%`;
}

function itemMarketUrl(id, name) {
  return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${id}${name ? `&itemName=${encodeURIComponent(name)}` : ''}`;
}

function buildBoardEmbed() {
  const buys = [];
  const sells = [];
  for (const id of priceData.watchlist) {
    const rec = priceData.items[id];
    if (!rec || !rec.history.length) continue;
    const prices = rec.history.map((h) => h.p);
    const current = prices[prices.length - 1];
    const st = robustStats(rec);
    const high = st ? st.high : current;
    const sig = computeSignal(rec);
    const last = rec.history[rec.history.length - 1];
    const qty = last.q || 0;
    if (sig && sig.signal === 'buy') {
      const profit = Math.round(qty * (high * (1 - SELL_FEE) - current));
      if (profit > 0) {
        buys.push({ id, name: rec.name, buy: current, qty, sell: high, profit });
      }
    } else if (sig && sig.signal === 'sell') {
      sells.push({ id, name: rec.name, sell: current });
    }
  }
  buys.sort((a, b) => b.profit - a.profit);
  const topBuys = buys.slice(0, 3);
  const lines = [];
  for (const b of topBuys) {
    lines.push(`\u{1F7E2} [**${b.name}**](${itemMarketUrl(b.id, b.name)}) \u2014 buy $${shortMoney(b.buy)} \u00D7${fmt(b.qty)} \u00B7 Sell $${shortMoney(b.sell)} \u2192 +$${shortMoney(b.profit)}`);
  }
  for (const s of sells) {
    lines.push(`\u{1F534} [**${s.name}**](${itemMarketUrl(s.id, s.name)}) \u2014 sell now $${shortMoney(s.sell)}`);
  }
  if (!lines.length) {
    return [{
      title: '\u{1F4CA} Price Board',
      description: 'No profitable flips right now \u00B7 updates every 40s',
      color: 0x5865f2,
    }];
  }

  const chunks = [];
  let cur = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length > 3900 && cur.length) {
      chunks.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));

  return chunks.map((desc, i) => ({
    title: chunks.length === 1
      ? `\u{1F4CA} Price Board \u2014 ${topBuys.length} buy \u00B7 ${sells.length} sell`
      : `\u{1F4CA} Price Board (${i + 1}/${chunks.length}) \u2014 ${topBuys.length} buy \u00B7 ${sells.length} sell`,
    description: desc,
    color: 0x5865f2,
    footer: { text: 'Buy at real low, sell at realistic high (after 5% fee) \u00B7 updates every 40s' },
  }));
}

async function updatePriceBoard() {
  const channels = BOARD_CHANNEL_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  for (const channelId of channels) {
    await updateBoardInChannel(channelId);
  }
  savePrices();
}

async function updateBoardInChannel(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.messages) return;
    const embeds = buildBoardEmbed();
    const ids = (priceData.boards && priceData.boards[channelId]) || [];
    let msg = null;
    if (ids[0]) {
      try { msg = await channel.messages.fetch(ids[0]); } catch (e) { msg = null; }
    }
    if (msg) {
      await msg.edit({ content: '', embeds });
    } else {
      msg = await channel.send({ embeds });
    }
    priceData.boards[channelId] = [msg.id];
    for (let i = 1; i < ids.length; i++) {
      try {
        const extra = await channel.messages.fetch(ids[i]);
        if (extra) await extra.delete();
      } catch (e) {}
    }
  } catch (e) {
    console.error('[discord-bot] board update failed for', channelId, ':', e.message, e.rawError ? JSON.stringify(e.rawError).slice(0, 300) : '');
  }
}

function profileUrl(playerId) {
  return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(playerId)}`;
}

function memberStatusIcon(member) {
  if (member.last_action && member.last_action.status === 'Online') return '\u{1F7E2}';
  if (member.status && member.status.state === 'Traveling') return '\u2708\uFE0F';
  const ts = member.last_action && member.last_action.timestamp;
  if (ts) {
    const hours = (Date.now() / 1000 - ts) / 3600;
    if (hours < 48) return '\u26AA';
    if (hours < 168) return '\u{1F7E1}';
    return '\u{1F534}';
  }
  return '\u{1F534}';
}

let lastMembersBoardRun = 0;
function membersBoardThrottleSeconds() {
  const v = parseInt(process.env.MEMBER_BOARD_INTERVAL, 10);
  return Number.isFinite(v) && v > 0 ? v : 300;
}

async function updateMembersBoard() {
  const channelId = process.env.MEMBER_BOARD_CHANNEL_ID || process.env.MEMBER_INTRO_CHANNEL_ID;
  if (!channelId) return;
  const now = Date.now();
  if (now - lastMembersBoardRun < membersBoardThrottleSeconds() * 1000) return;
  lastMembersBoardRun = now;
  await updateMembersBoardInChannel(channelId);
}

async function updateMembersBoardInChannel(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.messages) return;
    const d = await tornGet('faction', FACTION_ID, 'basic');
    if (!d || !d.members) return;

    const tzLookup = {};
    for (const acct of accountStore.getAllAccounts()) {
      if (acct.torn_username) tzLookup[acct.torn_username.trim().toLowerCase()] = acct.timezone || null;
    }

    const rows = Object.entries(d.members || {}).map(([playerId, m]) => ({
      playerId,
      name: m.name,
      level: m.level,
      position: m.position,
      icon: memberStatusIcon(m),
      lastTs: m.last_action ? m.last_action.timestamp : 0,
      tz: tzLookup[String(m.name).trim().toLowerCase()] || timezoneRoster.timezoneForTornName(m.name),
    }));
    rows.sort((a, b) => {
      if (a.lastTs !== b.lastTs) return b.lastTs - a.lastTs;
      if (a.icon !== b.icon) return (a.icon === '\u{1F7E2}' || a.icon === '\u2708\uFE0F') ? -1 : 1;
      return (b.level || 0) - (a.level || 0);
    });

    const lines = [];
    for (const r of rows) {
      const tz = r.tz ? tzNormalize.normalize(r.tz).display : null;
      lines.push(`${r.icon} [**${r.name}**](${profileUrl(r.playerId)}) \u2014 ${r.position}, L${r.level}${tz ? ` \u00B7 ${tz}` : ''}`);
    }
    const title = `\u{1F465} ${d.name || 'Faction'} Members \u2014 ${rows.length}`;
    const footer = '\u{1F7E2} online \u00B7 \u2708 traveling \u00B7 \u26AA offline <2d \u00B7 \u{1F7E1} 2\u20136d \u00B7 \u{1F534} 7d+';

    const chunks = [];
    let cur = [];
    let len = 0;
    for (const line of lines) {
      if (len + line.length > 3900 && cur.length) {
        chunks.push(cur.join('\n'));
        cur = [];
        len = 0;
      }
      cur.push(line);
      len += line.length + 1;
    }
    if (cur.length) chunks.push(cur.join('\n'));

    if (!lines.length) lines.push('No members found.');
    const embeds = chunks.length ? chunks : [''];
    const embedsOut = embeds.map((desc, i) => ({
      title: embeds.length === 1 ? title : `${title} (${i + 1}/${embeds.length})`,
      description: desc,
      color: 0x5865f2,
      footer: { text: footer },
    }));

    let msgId = timezoneRoster.getBoardMsgId();
    let msg = null;
    if (msgId) {
      try { msg = await channel.messages.fetch(msgId); } catch (e) { msg = null; }
    }
    if (msg) {
      await msg.edit({ content: '', embeds: embedsOut });
      if (!msg.pinned) { try { await msg.pin(); } catch (e) {} }
    } else {
      msg = await channel.send({ embeds: embedsOut });
      timezoneRoster.setBoardMsgId(msg.id);
      try { await msg.pin(); } catch (e) { console.error('[discord-bot] member board pin failed:', e.message); }
    }
  } catch (e) {
    console.error('[discord-bot] members board update failed:', e.message);
  }
}

function robustStats(rec) {
  const prices = rec.history.map((h) => h.p).sort((a, b) => a - b);
  const n = prices.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const low = prices[0];
  if (n < 20) {
    return { low, high: prices[n - 1], median, trimmed: false };
  }
  const k = Math.floor(n * 0.15);
  const core = prices.slice(0, n - k);
  if (!core.length) return { low, high: prices[n - 1], median, trimmed: false };
  const pctHigh = (p) => {
    if (core.length === 1) return core[0];
    const i = Math.min(core.length - 1, Math.max(0, Math.round((p / 100) * (core.length - 1))));
    return core[i];
  };
  return { low, high: pctHigh(85), median, trimmed: true, coreCount: core.length };
}

function computeSignal(rec) {
  if (!rec || !rec.history.length) return null;
  if (isPriceStale(rec)) return null;
  const st = robustStats(rec);
  if (!st || st.high <= st.low) return null;
  const prices = rec.history.map((h) => h.p);
  const current = prices[prices.length - 1];
  const low = st.low;
  const high = st.high;
  const spreadPct = (high - low) / low * 100;
  const posPct = (current - low) / (high - low) * 100;
  const marginPct = (high * (1 - SELL_FEE) - current) / current * 100;
  let signal = 'hold';
  if (posPct <= 10) signal = 'buy';
  else if (posPct >= 90) signal = 'sell';
  return { current, low, high, spreadPct, posPct, marginPct, signal };
}

async function handleFlip(message) {
  const opps = [];
  for (const id of priceData.watchlist) {
    const rec = priceData.items[id];
    if (!rec || rec.history.length < ALERT_MIN_HISTORY) continue;
    const sig = computeSignal(rec);
    if (sig && sig.signal === 'buy' && sig.marginPct > 0) {
      opps.push({ id, name: rec.name, sig });
    }
  }
  if (!opps.length) {
    await message.reply('No profitable flips right now.');
    return;
  }
  opps.sort((a, b) => b.sig.marginPct - a.sig.marginPct);
  const desc = opps.slice(0, 10).map((o) =>
    `\u2022 [**${o.name}**](${itemMarketUrl(o.id, o.name)}) \u2014 buy $${fmt(o.sig.current)} \u2192 realistic high $${fmt(o.sig.high)} (**+${o.sig.marginPct.toFixed(1)}%** after 5% fee)`
  ).join('\n');
  await message.reply({ embeds: [{ title: '\u{1F4B0} Top flips (buy now, resell at 24h high)', description: desc, color: 0x2ecc71 }] });
}

async function resolveItem(query) {
  let id = query;
  let name = '';
  if (!/^\d+$/.test(query)) {
    const items = await getItemsCache();
    const found = Object.entries(items).find(([, it]) => (it.name || '').toLowerCase() === query.toLowerCase());
    if (!found) return null;
    id = found[0];
    name = found[1].name;
  }
  return { id, name };
}

async function handlePriceHistory(message, query) {
  if (!query) {
    await message.reply('Usage: `!ph <item name or id>`');
    return;
  }
  const r = await resolveItem(query);
  if (!r) {
    await message.reply(`Item "${query}" not found.`);
    return;
  }
  const rec = priceData.items[r.id];
  if (!rec || !rec.history.length) {
    await message.reply(`No price history for **${r.name || '#' + r.id}** yet. Watch it with \`!watch ${r.name || r.id}\` and wait a poll.`);
    return;
  }
  const name = rec.name || r.name || `#${r.id}`;
  const current = rec.history[rec.history.length - 1].p;
  const dayHigh = Math.max(...rec.history.map((h) => h.p));
  const dayLow = Math.min(...rec.history.map((h) => h.p));
  const lines = [`**${name}** [#${r.id}]`];
  lines.push(`Current: **$${fmt(current)}**`);
  if (rec.allTimeHigh) lines.push(`All-time high: **$${fmt(rec.allTimeHigh.price)}** (${timeAgo(rec.allTimeHigh.at)})`);
  if (rec.allTimeLow) lines.push(`All-time low: **$${fmt(rec.allTimeLow.price)}** (${timeAgo(rec.allTimeLow.at)})`);
  lines.push(`24h high: $${fmt(dayHigh)}  •  24h low: $${fmt(dayLow)}`);
  lines.push(`Readings: ${rec.history.length}`);
  await message.reply(lines.join('\n'));
}

async function handleWatch(message, query) {
  if (!query) {
    await message.reply('Usage: `!watch <item name or id>`');
    return;
  }
  const r = await resolveItem(query);
  if (!r) {
    await message.reply(`Item "${query}" not found.`);
    return;
  }
  if (priceData.watchlist.length >= 60 && !priceData.watchlist.includes(r.id)) {
    await message.reply('Watchlist is full (60 items). Remove one with `!unwatch <item>` first.');
    return;
  }
  if (!priceData.watchlist.includes(r.id)) {
    priceData.watchlist.push(r.id);
    priceData.inactive = priceData.inactive.filter((x) => x !== r.id);
    priceData.items[r.id] = priceData.items[r.id] || { name: r.name || `#${r.id}`, allTimeHigh: null, allTimeLow: null, history: [] };
    savePrices();
    await message.reply(`Watching **${r.name || '#' + r.id}** (#${r.id}).`);
  } else {
    await message.reply(`Already watching **${r.name || '#' + r.id}**.`);
  }
}

async function handleUnwatch(message, query) {
  if (!query) {
    await message.reply('Usage: `!unwatch <item name or id>`');
    return;
  }
  const r = await resolveItem(query);
  if (!r) {
    await message.reply(`Item "${query}" not found.`);
    return;
  }
  const idx = priceData.watchlist.indexOf(r.id);
  if (idx >= 0) {
    priceData.watchlist.splice(idx, 1);
    savePrices();
    await message.reply(`Stopped watching #${r.id}.`);
  } else {
    await message.reply(`#${r.id} isn't in the watchlist.`);
  }
}

async function handleWatchlist(message) {
  if (!priceData.watchlist.length) {
    await message.reply('Watchlist is empty. Use `!watch <item>` to add items.');
    return;
  }
  const lines = priceData.watchlist.map((id) => {
    const rec = priceData.items[id];
    const name = rec ? rec.name : `#${id}`;
    const current = rec && rec.history.length ? ` — $${fmt(rec.history[rec.history.length - 1].p)}` : '';
    return `**${name}** (#${id})${current}`;
  });
  const inactiveNote = priceData.inactive.length ? `\n\n${priceData.inactive.length} paused (not selling) — auto re-added when activity returns.` : '';
  await message.reply(`**Watching ${priceData.watchlist.length} items:**\n${lines.join('\n')}${inactiveNote}`);
}

function timeAgo(ts) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

process.on('SIGTERM', () => {
  savePrices();
  process.exit(0);
});
process.on('SIGINT', () => {
  savePrices();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
