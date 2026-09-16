import { OrderTypes } from "../entity/Order";
import { toStateName } from "./states";

export const MAX_BLUESKY_LENGTH = 300;
export const MAX_TWEET_LENGTH = 280;

export interface MessageOrder {
  quantity: number;
  orderType: string;
  restaurant: string | null;
  location: { city: string; state: string; address: string };
}

/**
 * Template design rules (issue #223):
 *
 * Twitter/X, Threads, and BlueSky render posts in proportional fonts and
 * collapse runs of regular whitespace. Templates therefore MUST NOT depend
 * on cross-line column alignment:
 *
 *   1. No variable content ({{...}} placeholders) inside box/border art —
 *      no `| content |`, no `￣￣|` table tops, no `───` rules on the same
 *      line as a placeholder. Variable-length values tear fixed-width art.
 *   2. Art lines are self-contained: single-line contiguous figures
 *      (kaomoji, table-flips, `▁▂▄▆█` ramps), uniform per-line prefixes
 *      (`┻┳| •.•)`), or pure-art blocks with content moved to prose lines.
 *   3. Intentional whitespace (art indentation, double spaces) is written
 *      with regular spaces and converted to non-breaking spaces at render
 *      time by `preserveWhitespace` — platforms collapse regular space
 *      runs but never NBSPs.
 *   4. Keep templates short enough that even a long restaurant name, city,
 *      and address stay under MAX_TWEET_LENGTH — mid-post truncation
 *      ("...") looks broken, especially inside art.
 *
 * `scripts/audit-message-templates.ts` lints every template against these
 * rules; the same checks run in message-templates.test.ts.
 */
export const TEMPLATES: readonly string[] = [
  // -----------------------------------------------------------------------
  // Prose / joke templates
  // -----------------------------------------------------------------------
  "A line at a polling place? Unpossible!\n\nWe're choo choo choosing to send {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location City}} {{2. Location State}} to help",
  "HERE COMES DAT PIZZA 🍕\n\nO shit waddup {{2. Location City}} — {{3. Pizzas}} from {{3. Restaurant}} headed your way",
  "There are pizzas everywhere for those with the eyes to see 🍕✨👀\n\nLess cryptically: {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "Brace yourselves, {{2. Location City}}. Incoming: {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}}! Keep calm and pizza on. 🍕🗳️",
  "A line at {{2. Location City}}? Not very demure, not very mindful. Maybe {{3. Pizzas}} from {{3. Restaurant}} will help",
  "Hey {{2. Location City}} - hear you've got a line at {{2. Location Address}}. Here's {{3. Pizzas}} from {{3. Restaurant}}",
  "Got a report 📲 of a line at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}. Phoning in {{3. Pizzas}} from {{3. Restaurant}}",
  "Somebody need a 🍕 at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}? Howabout {{3. Pizzas}} from {{3. Restaurant}}",
  "Democracy is delicious. Proof: {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}}, {{2. Location City}} {{2. Location State}} 🗳️🍕",
  "The line at {{2. Location Address}} was long. The slices will be longer. {{3. Pizzas}} from {{2. Restaurant}} on the way to {{2. Location City}} {{2. Location State}}.",
  "Give me liberty or give me pepperoni 🍕 — {{3. Pizzas}} from {{2. Restaurant}} for the voters at {{2. Location City}} {{2. Location State Name}}",
  "E pluribus unum: out of many voters, one pizza order. {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location City}} {{2. Location State}}",
  "A well-fed electorate is a patient electorate. Sending {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "It's called checks and balances: we checked the line at {{2. Location Address}} and balanced it with {{3. Pizzas}} from {{2. Restaurant}}",
  "Bread and circuses? We upgraded to pizza. {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}} — panem et pizzam 🍕🏛️",
  "Read the room? We read the line at {{2. Location Address}}. Pizza's coming: {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}}",
  "You get a slice! And YOU get a slice! Everybody voting at {{2. Location Address}} gets a slice! ({{3. Pizzas}} from {{2. Restaurant}})",
  "One person, one vote, {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location City}} {{2. Location State}}",
  "Democracy: the one time standing in line gets you free pizza. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location City}} {{2. Location State}}",
  "Pizza: the unofficial fifth branch of government 🍕🏛️ {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}}",
  "Certified line-killer incoming ⚡ {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location City}} {{2. Location State}} — clear the runway",
  "We heard the line at {{2. Location Address}} has its own zip code. Sending {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location City}} {{2. Location State}} 📮",
  "Democracy, but make it delicious ✨ {{3. Pizzas}} from {{2. Restaurant}} for the voters at {{2. Location City}} {{2. Location State Name}}",
  "Vote early, snack late: {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "Sir, this is a democracy 🧢 — and those {{3. Pizzas}} from {{2. Restaurant}} go to {{2. Location City}} {{2. Location State Name}}",
  "The pizza-to-the-pollin' pipeline is LIVE: {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location City}} {{2. Location State}} 🚰",
  "Somewhere over the rainbow... no wait, it's just {{3. Pizzas}} from {{2. Restaurant}} gliding down to {{2. Location City}} {{2. Location State Name}} 🌈",
  "This message was paid for by carbs 🍕\n{{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State Name}}",
  "Weather report for {{2. Location City}} {{2. Location State}}: 100% chance of {{3. Pizzas}} from {{2. Restaurant}} over {{2. Location Address}} 🌧️🍕",
  "*current vibes at {{2. Location Address}}*\nline: long 😤\npizza: solved 😎\n({{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}})",

  // -----------------------------------------------------------------------
  // Kaomoji / single-line art with content in prose position
  // -----------------------------------------------------------------------
  "👑\n🍕 🍕\n👁  👁👂\n   👃  \n   👄 - Oh? They need pizza at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}? Here's {{3. Pizzas}} from {{3. Restaurant}}",
  "♪♬  ON MY WAY  ᕕ(⌐■_■)ᕗ  ♪♬ \n\n♪♬  TO DELIVER {{3. Pizzas}} ♪♬ \n♪♬ FROM {{3. Restaurant}} ♪♬ \n\n♪♬  TO {{2. Location City}}, {{2. Location State Name}} ♪♬",
  "¡Ay, caramba! (⊙_⊙)\n{{3. Pizzas}} from {{3. Restaurant}}\nen route to {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "(☞ﾟヮﾟ)☞ it's right here: {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "┬─┬ノ( º _ ºノ) — putting the table back because we're civil. Enjoy {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location City}} {{2. Location State}}",
  "(¬‿¬) we saw that line at {{2. Location Address}}... and did something about it. {{3. Pizzas}} from {{2. Restaurant}}, {{2. Location City}} {{2. Location State}}",
  "٩(◕‿◕)۶ {{2. Location City}}! Rejoice! {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}}!",
  "¯\\_(ツ)_/¯ we can't shorten the line at {{2. Location Address}}, but we CAN send {{3. Pizzas}} from {{2. Restaurant}}",
  "(╯°□°)╯︵🍕 FLIPPED — just kidding, it's handled: {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}}",
  "✧◝(⁰▿⁰)◜✧ good news, {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}}! ✧",
  "ᕕ( ᐛ )ᕗ what's good? {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "( ͡° ͜ʖ ͡°) we see you at {{2. Location Address}}... voting. Respect. Here's {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}}",
  "(づ｡◕‿‿◕｡)づ a gift for {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}} — for being excellent citizens",
  "Σ(°ロ°) wait, there's a LINE at {{2. Location Address}}?? Dispatching {{3. Pizzas}} from {{2. Restaurant}} immediately — {{2. Location City}} {{2. Location State}}",
  "(◕ᴗ◕✿) be nice to your poll workers. Also, here's {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "ᕙ( • ‿ • )ᕗ get in formation! {{3. Pizzas}} from {{2. Restaurant}} coming to {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "(∪.∪ )...zzz nobody's sleeping on this line — {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "( ˘ ³˘)♥ our love language: {{3. Pizzas}} from {{2. Restaurant}} delivered to {{2. Location City}} {{2. Location State Name}}",
  "ヽ(°〇°)ﾉ BREAKING: {{2. Location City}} polling place at {{2. Location Address}} just got {{3. Pizzas}} from {{2. Restaurant}}!",
  "ʕ•ᴥ•ʔ bear with the line at {{2. Location Address}} — or don't. {{3. Pizzas}} from {{2. Restaurant}} coming in hot for {{2. Location City}} {{2. Location State}}",
  '( •_•)>⌐■-■ (⌐■_■) deal with it — and by "it" we mean {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location City}} {{2. Location State}}',
  "ヽ(´▽`)/ tanoshii! {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location City}} {{2. Location State}} — democracy is a party when there's pizza",
  "( •̀ᴗ•́ )و let's gooooo {{2. Location City}}! {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}}!",
  "⊂(´・ω・｀⊂) hold up — a line at {{2. Location Address}}? Not on our watch. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location City}} {{2. Location State}}",
  "Have a pizza my heart 😻 {{2. Location Address}} {{2. Location City}} {{2. Location State Name}} Or really {{3. Pizzas}} from {{3. Restaurant}}",
  "Slice to meet you {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}! Enjoy {{3. Pizzas}} from {{3. Restaurant}}",
  "Read my lips {{3. Pizzas}} from {{3. Restaurant}} ✌(-‿ -)✌\n          |\n          ^\n\nFor {{2. Location City}} {{2. Location State Name}}",

  // -----------------------------------------------------------------------
  // Multi-line art: art blocks are self-contained, content on prose lines
  // -----------------------------------------------------------------------
  "_______________________________\n{{3. Pizzas}} from {{2. Restaurant}} → {{2. Location City}} {{2. Location State}}\n-------------------------------\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )/\\\n                ||----w |\n                ||     ||",
  "╱|、\n(˚ˎ 。7    ~ trotting out {{3. Pizzas}} ~\n|、˜〵     ~ from {{2. Restaurant}} ~\nじしˍ,)ノ   ~ to {{2. Location City}} {{2. Location State}} ~\n\ndelivered right MEOW",
  "(__)\n `--(oo)\n  ||\\\n  || w||\n\nMOOOOVE over, {{2. Location State Name}} —\nwe've got {{3. Pizzas}} from {{2. Restaurant}}\nfor {{2. Location City}}",
  "/)-/)\n(* •• \\\n/ (*   *)\n    /o / uu\n  /O/\n/o /\n 0/\n /\n\ntall order of {{3. Pizzas}}\nfrom {{2. Restaurant}}\nto {{2. Location City}} {{2. Location State}}",
  "⊂_ヽ\n    ＼＼ Λ＿Λ\n      ＼( ˇωˇ)\n        /    ⌒\n     /        へ＼\n   /     / ＼＼\n  ﾚ ノ   ヽ_つ\n\nsent {{3. Pizzas}} from {{2. Restaurant}}\nto {{2. Location City}} {{2. Location State}}",
  "Checking our list (twice) but we hear lines aren't nice at {{2. Location City}} {{2. Location State Name}}\n    🍕\n    🎄\n   🎄🎄\n  🎄⁣🎄🎄\n 🎄🎄🎄🎄\n🎄🎄🎄🎄🎄\n  🗳🗳🗳\n\n(check under your tree - it's {{3. Pizzas}} from {{2. Restaurant}} 🎅!)",
  "*Phew* — {{3. Pizzas}} from {{2. Restaurant}} sent to {{2. Location City}}, {{2. Location State Name}}.\n\n (´･ω･)  =3 phew\n /  ⌒ヽ\n(人＿＿つ_つ",
  "┏┓┏┓｡･ﾟﾟ･｡ﾟ💖\n┃┗┛  appy 💜\n┃┏┓  day *ﾟ✾\n┗┛┗\n\n{{3. Pizzas}} from {{2. Restaurant}} ✿\nfor {{2. Location City}}, {{2. Location State Name}} 💛",
  "CRANK THAT DIAL, {{2. Location City}}\n🔊 {{3. Pizzas}} from {{2. Restaurant}} 🔊\n\n▁▂▄▆█ PIZZA TIME █▆▄▂▁\nMIN ───●──●──●── MAX\n\nto {{2. Location Address}} {{2. Location State}}",
  "＿＿\n／＞ 🍕フ\n|  _ _ |\n／` ミ＿xノ\n/     |\n/ ヽ ﾉ＿\n\nteleporting {{3. Pizzas}} from {{2. Restaurant}}\nto {{2. Location City}} {{2. Location State}}",
  "{{3. Pizzas}}?\n        ∧＿∧ \n      (´･ω･)\n| ⌒Ｙ⌒ / /\n\\ヽ    ｜   ﾉ／\n ＼ ﾄー🍕ーｲ /\n  ｜  ミ土彡 ｜\n\nABS-OLUTELY ♨️\nfrom {{2. Restaurant}}\nfor {{2. Location City}} {{2. Location State Name}}",
  "(•_•)\n<)   )╯  {{3. Pizzas}}\n/    \\\n\n\\(•_•)\n(   (>  from {{3. Restaurant}}\n/    \\\n\n (•_•)\n<)   )>  to {{2. Location City}} {{2. Location State}}!\n/    \\",
  "{{2. Location Address}} {{2. Location City}} {{2. Location State Name}} 。☆。*。☆。\n★。＼｜／。★\n♥----- ^_^.----♥\n★。／｜＼。★\n.。☆。*。☆.¸¸.•*'*•.★\n*♥ {{3. Pizzas}} *☆  on the way  ♥*\nfrom {{2. Restaurant}}",
  "(\__/)\n(•ㅅ•)  📦\n/   づ\n\ndelivering {{3. Pizzas}}\nfrom {{2. Restaurant}}\nto {{2. Location City}}, {{2. Location State Name}}",
  "(\__/)\n(•ㅅ•) delivering\n/   づ〜\n\n{{3. Pizzas}} from {{2. Restaurant}}\nto {{2. Location City}} {{2. Location State}}\n\nfor democracy, of course   (\__/)\n                          (•ㅅ•)",
  "{\\__/}\n( • . •)\n/ > 🗳  psst. look at this polling place at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}\n{\\__/}\n(ò . ó)\n/ > 🗳  𝐖𝐄 𝐒𝐄𝐍𝐓 𝐈𝐓 {{3. Pizzas}} (from {{3. Restaurant}})",
  "{{2. Location Address}} {{2. Location City}} {{2. Location State Name}}\n┻┳|\n┳┻|\n┻┳|\n┳┻| _\n┻┳| •.•) We just sent \n┳┻|⊂ﾉ {{3. Pizzas}}\n┻┳|      from {{3. Restaurant}}",
  "┬──┬◡ﾉ(° -°ﾉ) {{3. Pizzas}}?\n\nʕノ•ᴥ•ʔノ ︵ ┻━┻    🍕🍕\n\ncoming atcha, {{2. Location City}} {{2. Location State Name}}\nfrom {{3. Restaurant}}",
  "🍕🍕 ┻━┻︵ \\(°□°)/ ︵ ┻━┻  🍕🍕 {{3. Pizzas}} from {{3. Restaurant}}, thusly thrown to {{2. Location City}} {{2. Location State}}",
  "ACCIO PIZZA! 🧙 (∩ ͡° ͜ʖ ͡°)⊃━☆ﾟ\n\n{{3. Pizzas}} from {{3. Restaurant}}\nto {{2. Location City}}, {{2. Location State Name}} 🧹",
  "⠀     🤠\n    🍕🍕🍕\n   👇 🍕 👇\n    🍕 🍕\n   🍕  🍕\n   👢      👢\nhowdy {{2. Location City}}, {{2. Location State Name}} — I'm the pizza sheriff and uv got {{3. Pizzas}} from {{3. Restaurant}}",
  "🚨 PIZZA ALERT 🚨\nlocation: {{2. Location Address}}, {{2. Location City}} {{2. Location State}}\nstatus: {{3. Pizzas}} from {{2. Restaurant}} en route\nthreat level: DELICIOUS",
  "bzzzt 📡 transmitting to {{2. Location City}}, {{2. Location State}}...\n▸ destination: {{2. Location Address}}\n▸ payload: {{3. Pizzas}}\n▸ source: {{2. Restaurant}}\n▸ ETA: ASAP 🍕",
  "hunger status at {{2. Location Address}}:\n[■■■■■■■□□□] CRITICAL\n\ndeploying {{3. Pizzas}} from {{2. Restaurant}}\nto {{2. Location City}} {{2. Location State}}",
  "mission log — {{2. Location City}} {{2. Location State}}\n> line detected at {{2. Location Address}}\n> countermeasures: {{3. Pizzas}}\n> source: {{2. Restaurant}}\n> status: NOMINAL 🍕",
  "recipe for democracy:\n1. voters (see: {{2. Location Address}}, {{2. Location City}} {{2. Location State}})\n2. a line (unavoidable)\n3. {{3. Pizzas}} from {{2. Restaurant}}\nserve hot 🍕",
  "🍕\n🍕🍕\n🍕🍕🍕\n🍕🍕🍕🍕\nvote pyramid for {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}} 🗳️",
  "🛵💨 🍕🍕🍕\nexpress lane open at {{2. Location Address}}, {{2. Location City}}\n{{3. Pizzas}} from {{2. Restaurant}} on the scooter",
  "🗳️✨ democracy works better carb-loaded:\n🍕 {{3. Pizzas}}\n🍕 from {{2. Restaurant}}\n🍕 for {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "polling place loading...\n📍 {{2. Location Address}}, {{2. Location City}} {{2. Location State}}\n\n█████▒▒▒ 68%\n\nalmost there — {{3. Pizzas}} from {{2. Restaurant}} incoming",
  "PIZZA TRAIN 🚂🚃🚃🚃💨\nnext stop: {{2. Location Address}}, {{2. Location City}} {{2. Location State}}\ncargo: {{3. Pizzas}} from {{2. Restaurant}}",
  "knock knock 🚪\nwho's there?\n{{3. Pizzas}} 🍕 from {{2. Restaurant}} for {{2. Location City}} {{2. Location State Name}} — sorry, we skipped the joke",
  "up up and away 🎈🍕\n{{3. Pizzas}} from {{2. Restaurant}}\nfloating down to {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "seatbelts on 🚗💨\n{{3. Pizzas}} from {{2. Restaurant}}\ncruising to {{2. Location Address}}, {{2. Location City}} {{2. Location State}}",
  "（　´∀｀）ノ＝＝＝＝＝＝🍕\n\nthere it goes — {{3. Pizzas}} from {{2. Restaurant}}\nlaunched at {{2. Location City}} {{2. Location State}}",
  "♡ ♡ ♡ ♡ ♡\nlove from {{2. Restaurant}}\n({{3. Pizzas}} for the voters at {{2. Location Address}}, {{2. Location City}} {{2. Location State}})\n♡ ♡ ♡ ♡ ♡",
];

const NBSP = "\u00a0";

/**
 * Twitter/X, Threads, and BlueSky collapse runs of regular spaces (and trim
 * line-leading whitespace) when rendering posts. Convert intentional
 * spacing — line indentation and runs of two or more spaces — to
 * non-breaking spaces, which survive whitespace collapsing on every
 * platform. Interior single spaces in prose stay as regular spaces.
 */
export function preserveWhitespace(text: string): string {
  return (
    text
      // trailing spaces are invisible once platforms trim them — drop them
      .replace(/[ \t]+$/gm, "")
      // runs of 2+ interior spaces → NBSP (art padding, prose double-spacing)
      .replace(/ {2,}/g, (run) => NBSP.repeat(run.length))
      // leading indentation → NBSP (art like the cowsay cow)
      .replace(/^ +/gm, (run) => NBSP.repeat(run.length))
  );
}

function selectTemplate(): string {
  return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
}

function typeLabel(orderType: string, quantity: number): string {
  if (orderType === OrderTypes.pizzas) {
    return quantity === 1 ? "pizza" : "pizzas";
  }
  if (orderType === OrderTypes.donuts) return "dozen donuts";
  return orderType;
}

/**
 * Render a specific template string with order data.
 *
 * All placeholders ({{2. Location City}}, {{3. Pizzas}}, etc.) are replaced
 * with values from the order. Dangling "from " fragments are cleaned up when
 * the restaurant is empty, and intentional whitespace is preserved with
 * non-breaking spaces so art survives social platform rendering.
 *
 * Exposed so tests and the audit script can render a *specific* template
 * deterministically (renderMessage picks one at random).
 */
export function renderTemplate(template: string, order: MessageOrder): string {
  const fullStateName =
    toStateName(order.location.state.toUpperCase()) ?? order.location.state;
  const label = typeLabel(order.orderType, order.quantity);
  const restaurant = order.restaurant ?? "";

  const replacements: Record<string, string> = {
    "{{3. Pizzas}}": `${order.quantity} ${label}`,
    "{{2. Restaurant}}": restaurant,
    "{{3. Restaurant}}": restaurant,
    "{{2. Location City}}": order.location.city,
    "{{2. Location State}}": order.location.state,
    "{{2. Location State Name}}": fullStateName,
    "{{2. Location Address}}": order.location.address,
  };

  let text = template;
  for (const [key, value] of Object.entries(replacements)) {
    text = text.split(key).join(value);
  }

  // Clean up dangling "from " when restaurant is empty.
  // "from  " (double space) → removed; "from " at end of line → removed.
  text = text.replace(/\b(from|FROM)\s{2,}/g, "");
  text = text.replace(/\b(from|FROM)\s+$/gm, "");

  return preserveWhitespace(text);
}

/**
 * Render a randomly-selected message template with order data.
 */
export function renderMessage(order: MessageOrder): string {
  return renderTemplate(selectTemplate(), order);
}

/**
 * Truncate a message to at most `maxLength` characters, appending "…" (as
 * three dots) when truncation is needed.
 */
export function truncateMessage(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Render a message and truncate it to the platform-specific character limit.
 */
export function renderAndTruncate(
  order: MessageOrder,
  platform: "bluesky" | "twitter",
): string {
  const text = renderMessage(order);
  const limit = platform === "bluesky" ? MAX_BLUESKY_LENGTH : MAX_TWEET_LENGTH;
  return truncateMessage(text, limit);
}
