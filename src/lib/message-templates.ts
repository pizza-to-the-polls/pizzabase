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
  "is it a party? is it a polling place? yes. {{3. Pizzas}} from {{2. Restaurant}} on the way to {{2. Location Address}} {{2. Location City}} 🎉",
  "manifesting a shorter line for {{2. Location City}}... but in the meantime, manifesting {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} ✨🔮",
  "idk who did the level design for the line at {{2. Location Address}} {{2. Location City}} but we just patched it with {{3. Pizzas}} from {{2. Restaurant}} 🛠️🍕",
  "the lines are long but the resolve is longer. sending {{3. Pizzas}} from {{2. Restaurant}} to support {{2. Location Address}} {{2. Location City}} 🍕🗳️",
  "you: voting 🗳️\nus: ordering {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}} in {{2. Location City}}\nthe line: defeated 🍕",
  "just ordered {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}} {{2. Location City}} because you all are doing great sweetie 💖",
  "hot take: voting is great. hotter take: voting while eating {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}} is spectacular",
  "voting line vibe check: hungry. solution: {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}} {{2. Location City}} 🍕",
  "nature is healing. voters are voting. and {{3. Pizzas}} from {{2. Restaurant}} are landing at {{2. Location Address}} in {{2. Location City}} 🌸🗳️",
  "i don't know who needs to hear this but: {{3. Pizzas}} from {{2. Restaurant}} currently headed to the line at {{2. Location Address}} in {{2. Location City}} 🗣️",
  "the urge to stand in line vs the urge to eat {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} in {{2. Location City}} (why not both?)",
  "voting line: 📈\nappetite: 📈\n{{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location City}}: 🚀",
  "not all heroes wear capes. some wear delivery hats and carry {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} in {{2. Location City}} 🫡",
  "we analyzed the data and concluded that standing in line at {{2. Location Address}} {{2. Location City}} is 100% better when holding a slice of {{3. Pizzas}} from {{2. Restaurant}}",
  "local voters reporting a severe lack of melted cheese at {{2. Location Address}} {{2. Location City}}. dispatching {{3. Pizzas}} from {{2. Restaurant}} to fix the glitch 💻🍕",
  "if you're in line at {{2. Location Address}} in {{2. Location City}}: DO NOT LEAVE. the line is moving, and more importantly, {{3. Pizzas}} from {{2. Restaurant}} are on the way 🗳️",
  "graphics are great, but the gameplay at {{2. Location Address}} {{2. Location City}} just got upgraded with {{3. Pizzas}} from {{2. Restaurant}} 🎮",
  "voting: 10/10\nwaiting: 2/10\nwaiting with {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} in {{2. Location City}}: 11/10",
  "we hear the line at {{2. Location Address}} in {{2. Location City}} is long enough to listen to a whole podcast. enjoy {{3. Pizzas}} from {{2. Restaurant}} while you listen 🎧",
  "shoutout to the voters in {{2. Location City}}! we see you at {{2. Location Address}}. here is some carb-based moral support: {{3. Pizzas}} from {{2. Restaurant}} 🫡",
  "your vote is your voice. and our voice is screaming for cheese. {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}!",
  "legend has it that if you wait in line at {{2. Location Address}} {{2. Location City}}, a delivery driver appears with {{3. Pizzas}} from {{2. Restaurant}}. (the legend is real)",
  "stuck in line at {{2. Location Address}} in {{2. Location City}}? we just sent {{3. Pizzas}} from {{2. Restaurant}} because you deserve a treat for showing up 🗳️✨",
  "doing our part for the constitutional right to snack. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "to the line at {{2. Location Address}} {{2. Location City}}: we see you. we respect you. we ordered you {{3. Pizzas}} from {{2. Restaurant}}. eat up!",
  "please accept this edible token of our appreciation for standing in line at {{2. Location Address}} {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} 🍕",
  "this polling place at {{2. Location Address}} {{2. Location City}} is officially sponsored by carbs. {{3. Pizzas}} from {{2. Restaurant}} incoming 🗳️",
  "current status at {{2. Location Address}} {{2. Location City}}:\n- democracy: happening 🗳️\n- hunger: being actively countered by {{3. Pizzas}} from {{2. Restaurant}}",
  "it's a beautiful day to vote and a beautiful day to eat {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} in {{2. Location City}}",
  "shoutout to everyone standing in line at {{2. Location Address}} in {{2. Location City}} — {{3. Pizzas}} from {{2. Restaurant}} are on the way to keep you company!",
  "civic duty: exercised. stomach growling: silenced. {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}} {{2. Location City}}! 🗳️",
  "sending some crust-based motivation to {{2. Location Address}} {{2. Location City}} {{2. Location State}}: {{3. Pizzas}} from {{2. Restaurant}} 🍕🫡",
  "the only thing that should be gatekeeping you from voting is deciding which slice to take. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}} {{2. Location City}}",
  "democracy works up an appetite. we're sending {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}} to help 🗳️✨",
  "sending hot, cheesy reinforcement to the voters at {{2. Location Address}} {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} 🍕🗳️",
  "if you're waiting at {{2. Location Address}} {{2. Location City}}, check the horizon: {{3. Pizzas}} from {{2. Restaurant}} are coming to rescue your stomach",
  "just a casual delivery of {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} in {{2. Location City}} because voters are the real VIPs 🌟",
  'the line at {{2. Location Address}} {{2. Location City}} is long, but help is on the way (and by "help" we mean {{3. Pizzas}} from {{2. Restaurant}})',
  "fueling the ballot box with pizza boxes. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} in {{2. Location City}} 🗳️📦",
  'putting the "party" back in non-partisan. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}} 🎉',
  "nothing but respect for the voters at {{2. Location Address}} {{2. Location City}} — and nothing but cheese for {{3. Pizzas}} from {{2. Restaurant}} 🫡",
  "we can't make the line move faster at {{2. Location Address}} {{2. Location City}}, but we can make it taste like {{3. Pizzas}} from {{2. Restaurant}}",
  "your civic engagement is inspiring. our pizza ordering is relentless. {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}! 🍕",
  "voter turnout: high 📈\npizza turnout: also high 🍕\n{{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "sending some cheesy moral support to the line at {{2. Location Address}} {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} 🗳️🍕",
  "to the legendary voters at {{2. Location Address}} {{2. Location City}} — please enjoy {{3. Pizzas}} from {{2. Restaurant}} on us! 🫡✨",
  "making sure the lines of democracy are well-lubricated with garlic butter. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}} {{2. Location City}}",
  "standing in line builds character, but eating {{3. Pizzas}} from {{2. Restaurant}} builds morale. headed to {{2. Location Address}} {{2. Location City}}! 🍕",
  "democratizing the snack game: {{3. Pizzas}} from {{2. Restaurant}} landing at {{2. Location Address}} {{2. Location City}} 🗳️📦",
  "we heard there's a wait at {{2. Location Address}} {{2. Location City}} — so we sent {{3. Pizzas}} from {{2. Restaurant}} to keep the vibes immaculate ✨",
  "the line may be long at {{2. Location Address}} {{2. Location City}}, but so is our commitment to sending {{3. Pizzas}} from {{2. Restaurant}} 🫡🍕",
  "carbs for the community! {{3. Pizzas}} from {{2. Restaurant}} currently zooming toward {{2. Location Address}} {{2. Location City}} 🛵🗳️",
  "the ballot boxes are waiting, and so are the pizza boxes. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}} 📦",
  "respect the line. feed the line. {{3. Pizzas}} from {{2. Restaurant}} on the way to {{2. Location Address}} in {{2. Location City}} 🍕🗳️",
  "we've got eyes on the prize and pies on the lines. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}!",
  "standing in line is hard. standing in line with {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}} is a culinary experience",
  "voting is cool, but voting while munching on {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}} is next-level",
  "⬜⬜⬜🟥⬜⬜⬜\n⬜⬜🟥🧀🟥⬜⬜\n⬜🟥🧀🍕🧀🟥⬜\n🟫🟫🟫🟫🟫🟫🟫\n\n{{3. Pizzas}} from {{2. Restaurant}} are landing at {{2. Location Address}} {{2. Location City}}!",
  ' 🦀  "mine."\n(V)(;,,;)(V)\n  \\\\======/  🍕\n\n{{3. Pizzas}} from {{2. Restaurant}} spotted at {{2. Location Address}} {{2. Location City}}!',
  "     (∩ ͡° ͜ʖ ͡°)⊃━☆ﾟ.* \n     /      \\ \n  ✨  🍕  ✨\n\nACCIO PIZZA! {{3. Pizzas}} from {{2. Restaurant}} summoned to {{2. Location Address}} {{2. Location City}}",
  " ∧,,,∧\n( 👁 👁 )   ...soon\n(     っ🍕\n\n{{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} in {{2. Location City}}!",
  "         🍕\n       ▄█▀█▄\n     ▄█▀   ▀█▄\n ───█▀       ▀█───\n\nvibe wave high in {{2. Location City}}: {{3. Pizzas}} from {{2. Restaurant}} arrived at {{2. Location Address}}",
  "  ▂ ▄ ▅ ▆ ▇ █ 🍕 █ ▆ ▅ ▄ ▂  \n\ndemocracy is cranked to 11 at {{2. Location Address}} {{2. Location City}} — {{3. Pizzas}} from {{2. Restaurant}} are here!",
  "I am once again ordering {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}} {{2. Location City}} 🗳️🍕",
  "a line at {{2. Location Address}} {{2. Location City}}? it's more likely than you think. luckily, {{3. Pizzas}} from {{2. Restaurant}} are on the way",
  "🦋  is this a polling place?\n\nno, it's a party. we just sent {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}",
  "small brain: leaving the line because you're hungry\nbig brain: staying in line\ngalaxy brain: eating {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}}",
  "voters 🚶\n  ┗ 🍕 {{3. Pizzas}} from {{2. Restaurant}}\n  ┗ 📋 the long line at {{2. Location Address}} {{2. Location City}}",
  "🙅 Long lines with no food\n🙋 {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "👉 📦 ({{2. Restaurant}} box)\n👈 📦 (ballot box)\n\nboth doing important work at {{2. Location Address}} {{2. Location City}}! we sent {{3. Pizzas}}",
  "🔥 this is fine. actually, it's great: the line is moving and {{3. Pizzas}} from {{2. Restaurant}} are arriving at {{2. Location Address}} {{2. Location City}}",
  "them: can we leave the line to get food?\nus: we have {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "💊 hard pill to swallow:\nwaiting in line takes time. but eating {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}} makes it feel like seconds",
  "tier list of voter snacks:\nS tier: {{3. Pizzas}} from {{2. Restaurant}} (headed to {{2. Location Address}} {{2. Location City}})\nA tier: everything else",
  "Gru's Plan:\n1. Show up to vote 🗳️\n2. See a long line 📋\n3. {{3. Pizzas}} from {{2. Restaurant}} arrive at {{2. Location Address}} {{2. Location City}}\n4. Wait, free pizza? 🍕🍕",
  "per my last email, {{3. Pizzas}} from {{2. Restaurant}} are now in-flight to your coordinate at {{2. Location Address}} {{2. Location City}}",
  "lawful good: voting\nchaotic good: sending {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}} to feed the voters",
  "⬜⬜⬜⬜🟩⬜\n⬜⬜⬜🟩🟩⬜\n🟩⬜🟩🟩⬜⬜\n🟩🟩🟩⬜⬜⬜\n🗳️🗳️🗳️🗳️🗳️🗳️\n\n{{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}} {{2. Location City}}!",
  "⬜❤️⬜❤️⬜\n❤️🍕❤️🍕❤️\n❤️🍕🍕🍕❤️\n⬜❤️🍕❤️⬜\n⬜⬜❤️⬜⬜\n\nsending major love to {{2. Location City}}! {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}}",
  "🟡 🟡 🟡  🍕  🍕  🍕\n\nchomp chomp — {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} in {{2. Location City}}!",
  "👾  👾  👾  👾\n🚀  🚀  🚀  🚀\n🍕  🍕  🍕  🍕\n\nthe pizza armada from {{2. Restaurant}} has invaded {{2. Location Address}} {{2. Location City}} with {{3. Pizzas}}!",
  "⬜🟦🟦🟦⬜\n🟦🗳️🍕🗳️🟦\n⬜🟦🟦🟦⬜\n⬜🎗️⬜🎗️⬜\n\ncivic pride: high. {{3. Pizzas}} from {{2. Restaurant}} currently headed to {{2. Location Address}} {{2. Location City}}",
  "   📦🍕📦\n ┗ (•̀_•́) ┛\n   /    \\\n\ncarrying a heavy load of {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}!",
  " / \\__\n( °ヮ° )  *wag*\n/      \\ づ🍕\n\ngood boy alert! delivering {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}",
  "\\ ＼  ⚡  ／ /\n   ᕕ( ᐛ )ᕗ\n   /    \\\n\nthat feeling when {{3. Pizzas}} from {{2. Restaurant}} arrive at {{2. Location Address}} {{2. Location City}}!",
  " ~_~_~_~_~_~_ 🐍\n              (  º﹃º  )  *sniffing* 🍕\n\nslithering {{3. Pizzas}} from {{2. Restaurant}} to the line at {{2. Location Address}} {{2. Location City}}",
  "🦖  RAWR (means cheese in dinosaur)\n/ \\\n\n{{3. Pizzas}} from {{2. Restaurant}} dispatched to feed the wait times at {{2. Location Address}} {{2. Location City}}",
  "  👨‍🍳 \n ( ˘ᵕ˘ )  ✨🍕  *chef kiss*\n /  づ\n\ncrafted with care: {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "ʕっ•ᴥ•ʔっ 🍕  virtual hugs and physical pizzas!\n\n{{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "   🛸  ~ bzzzt ~\n  / 🍕 \\\n /  🗳️  \\\n\nbeam me up! {{3. Pizzas}} from {{2. Restaurant}} teleporting to {{2. Location Address}} {{2. Location City}}",
  "we don't care how you slice it, voting is essential. we're supporting {{2. Location Address}} {{2. Location City}} with {{3. Pizzas}} from {{2. Restaurant}}",
  "roses are red, voting is sweet, the line is long, so here's something to eat: {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location City}}!",
  "we got 99 problems but a cheese deficit at {{2. Location Address}} {{2. Location City}} ain't one. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "ranking the best parts of voting:\n1. shaping the future of your community\n2. the 'I voted' sticker\n3. {{3. Pizzas}} from {{2. Restaurant}} arriving at {{2. Location Address}} {{2. Location City}}",
  "our lawyers advised us that we cannot legally adopt the line at {{2. Location Address}} {{2. Location City}}, so we did the next best thing: sent {{3. Pizzas}} from {{2. Restaurant}}",
  "keep the line moving, keep the energy high, keep the cheese melting. {{3. Pizzas}} from {{2. Restaurant}} on the way to {{2. Location Address}} {{2. Location City}}",
  "voting line endurance training guide:\nstep 1: stand in line at {{2. Location Address}}\nstep 2: eat {{3. Pizzas}} from {{2. Restaurant}}\nstep 3: repeat step 2",
  "the line at {{2. Location Address}} {{2. Location City}} has met its match: {{3. Pizzas}} from {{2. Restaurant}} are officially in transit",
  "unlimited power? no, unlimited toppings. {{3. Pizzas}} from {{2. Restaurant}} on the way to the line at {{2. Location Address}} {{2. Location City}}",
  "whoever said 'nothing in life is free' clearly never stood in a long line at {{2. Location Address}} {{2. Location City}} when Pizza to the Polls is active. {{3. Pizzas}} from {{2. Restaurant}} on the way!",
  "we are physically incapable of seeing a long line at {{2. Location Address}} {{2. Location City}} and not ordering {{3. Pizzas}} from {{2. Restaurant}}. it's a reflex at this point.",
  "this just in: local voters at {{2. Location Address}} in {{2. Location City}} are absolute rockstars. we are celebrating with {{3. Pizzas}} from {{2. Restaurant}} 🎸🍕",
  "making sure your ballot is counted and your stomach is rounded. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}} {{2. Location City}}",
  "the line at {{2. Location Address}} in {{2. Location City}} may be daunting, but {{3. Pizzas}} from {{2. Restaurant}} are coming to turn it into a pizza party",
  "shoutout to the delivery drivers doing the real heavy lifting of democracy today. {{3. Pizzas}} from {{2. Restaurant}} landing at {{2. Location Address}} {{2. Location City}}! 🛵",
  "your ballot: cast. your hunger: surpassed. {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}} {{2. Location City}}!",
  "we heard the line at {{2. Location Address}} in {{2. Location City}} is so long it has a legislative agenda. sending {{3. Pizzas}} from {{2. Restaurant}} to sponsor a snack bill",
  "don't worry, the calorie counter doesn't count when you're waiting in line at {{2. Location Address}} {{2. Location City}}. enjoy {{3. Pizzas}} from {{2. Restaurant}} guilt-free!",
  "if you're at {{2. Location Address}} {{2. Location City}}, we want to make your day 100% more delicious. {{3. Pizzas}} from {{2. Restaurant}} are on the way!",
  "the only agenda we have today is cheese. {{3. Pizzas}} from {{2. Restaurant}} headed to the voters at {{2. Location Address}} in {{2. Location City}}",
  "to the line at {{2. Location Address}} {{2. Location City}}: stay strong. democracy is a marathon. here are some carbs to help you pace yourself: {{3. Pizzas}} from {{2. Restaurant}}",
  "civic duty meets absolute deliciousness. {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}} {{2. Location City}}",
  "we don't mean to brag, but we just ordered {{3. Pizzas}} from {{2. Restaurant}} for the line at {{2. Location Address}} {{2. Location City}} because you're all incredible",
  "fueling the democratic process with premium mozzarella. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "the ballot box is hungry for your vote, and you're hungry for {{3. Pizzas}} from {{2. Restaurant}}. both issues are being resolved at {{2. Location Address}} {{2. Location City}}",
  "voter motivation package unlocked 🔓: {{3. Pizzas}} from {{2. Restaurant}} are on their way to {{2. Location Address}} {{2. Location City}}!",
  "we've got an executive order of {{3. Pizzas}} from {{2. Restaurant}} heading straight to the line at {{2. Location Address}} {{2. Location City}}",
  "local weather update for {{2. Location Address}} {{2. Location City}}: a high-pressure system of {{3. Pizzas}} from {{2. Restaurant}} is moving in fast 🌦️🍕",
  "we aren't saying pizza is the answer to everything, but it's definitely the answer to 'what should we eat at {{2. Location Address}} {{2. Location City}}?'. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "supporting local lines with local slices. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}} 🗳️📦",
  "democracy is a team sport, and we are the designated snack parents. {{3. Pizzas}} from {{2. Restaurant}} heading to {{2. Location Address}} {{2. Location City}}!",
  "your dedication to voting at {{2. Location Address}} {{2. Location City}} is beautiful. our dedication to feeding you {{3. Pizzas}} from {{2. Restaurant}} is delicious",
  "shoutout to the voters in {{2. Location City}} making history at {{2. Location Address}}! here is some historical cheese: {{3. Pizzas}} from {{2. Restaurant}}",
  "we've commissioned {{3. Pizzas}} from {{2. Restaurant}} to protect the voters at {{2. Location Address}} {{2. Location City}} from low blood sugar",
  "line at {{2. Location Address}} {{2. Location City}} got you down? let us lift you up with {{3. Pizzas}} from {{2. Restaurant}} 🍕✨",
  "putting our money where your mouth is. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}!",
  "the lines are long but the crusts are crispy. {{3. Pizzas}} from {{2. Restaurant}} currently zooming toward {{2. Location Address}} {{2. Location City}} 🛵",
  "this is a non-partisan, pro-carbohydrate broadcast. {{3. Pizzas}} from {{2. Restaurant}} are on their way to {{2. Location Address}} {{2. Location City}}",
  "we hear the line at {{2. Location Address}} {{2. Location City}} is legendary. sending an equally legendary delivery: {{3. Pizzas}} from {{2. Restaurant}} 🌟🍕",
  "the line can't stop you, and hunger won't either. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}!",
  "we checked the forecasting models and there's an impending cheese storm at {{2. Location Address}} {{2. Location City}}. {{3. Pizzas}} from {{2. Restaurant}} incoming 🌀🍕",
  "voting is the ultimate power move. eating {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}} is the ultimate energy recovery",
  "to the line at {{2. Location Address}} in {{2. Location City}}: you represent the best of us, so we sent the best of {{2. Restaurant}}: {{3. Pizzas}} headed your way!",
  "making sure the wait at {{2. Location Address}} {{2. Location City}} is seasoned with garlic and oregano. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "hunger has been vetoed at {{2. Location Address}} {{2. Location City}}. {{3. Pizzas}} from {{2. Restaurant}} have been signed into law 🗳️📄",
  "our mission: no voter left behind, no stomach left empty. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "we are sending {{3. Pizzas}} from {{2. Restaurant}} to the line at {{2. Location Address}} {{2. Location City}} because you are all absolute legends",
  "keeping democracy fresh and lines fed. {{3. Pizzas}} from {{2. Restaurant}} are on their way to {{2. Location Address}} {{2. Location City}} 🍕🗳️",
  "we don't want to alarm you, but a highly delicious stack of {{3. Pizzas}} from {{2. Restaurant}} is currently closing in on {{2. Location Address}} {{2. Location City}}",
  "nothing says 'thank you for voting' quite like {{3. Pizzas}} from {{2. Restaurant}} landing at {{2. Location Address}} {{2. Location City}}",
  "supporting the long line at {{2. Location Address}} {{2. Location City}} with maximum cheese and minimum wait. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "voter energy levels: replenished. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}} ⚡🍕",
  "we're on a first-name basis with delivery drivers in {{2. Location City}} today. {{3. Pizzas}} from {{2. Restaurant}} en route to {{2. Location Address}}",
  "the line at {{2. Location Address}} {{2. Location City}} is long, but our resolve is infinite. {{3. Pizzas}} from {{2. Restaurant}} headed your way!",
  "no matter the wait at {{2. Location Address}} {{2. Location City}}, we've got you covered with {{3. Pizzas}} from {{2. Restaurant}}",
  "the ballot boxes are ready, and so are the appetite boxes. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}} 📦",
  "making sure your voting experience at {{2. Location Address}} {{2. Location City}} is 10/10. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "your civic duty is inspiring, so we're feeding the inspiration. {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}!",
  "to the voters at {{2. Location Address}} {{2. Location City}}: we are sending {{3. Pizzas}} from {{2. Restaurant}} to fuel your democratic power 🗳️✨",
  "the ultimate voting companion: a hot, fresh slice. {{3. Pizzas}} from {{2. Restaurant}} heading to {{2. Location Address}} {{2. Location City}}",
  "shoutout to {{2. Location City}} for showing up! we're sending {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} to help you stand strong",
  "democracy is a marathon, and we are handing out slices at the water station. {{3. Pizzas}} from {{2. Restaurant}} → {{2. Location Address}} {{2. Location City}}",
  "the lines are long, but the support is limitless. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}!",
  "fueling the future of {{2. Location City}} with {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} 🗳️🍕",
  "your vote matters. your hunger also matters. we're addressing both at {{2. Location Address}} {{2. Location City}} with {{3. Pizzas}} from {{2. Restaurant}}",
  "making sure the wait at {{2. Location Address}} {{2. Location City}} is accompanied by premium mozzarella. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "to the line at {{2. Location Address}} in {{2. Location City}}: stay in line, stay strong, and get ready for {{3. Pizzas}} from {{2. Restaurant}}!",
  "nothing but love (and cheese) for the voters at {{2. Location Address}} {{2. Location City}}. {{3. Pizzas}} from {{2. Restaurant}} on the way!",
  "the line at {{2. Location Address}} {{2. Location City}} just got a whole lot more delicious. {{3. Pizzas}} from {{2. Restaurant}} en route!",
  "voter turnout is amazing in {{2. Location City}}! we're celebrating with {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} 🎉",
  "keeping you fed while you make your voice heard. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}!",
  "to the incredible voters at {{2. Location Address}} {{2. Location City}}: help is on the way, in the form of {{3. Pizzas}} from {{2. Restaurant}} 🍕🫡",
  "democracy is beautiful, and so is a fresh slice. {{3. Pizzas}} from {{2. Restaurant}} headed to {{2. Location Address}} {{2. Location City}}",
  "your civic pride is unmatched. our pizza ordering is also unmatched. {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location Address}} {{2. Location City}}!",
  "the only thing better than voting is voting while eating {{3. Pizzas}} from {{2. Restaurant}} at {{2. Location Address}} {{2. Location City}}",
  "we hear the line is long at {{2. Location Address}} {{2. Location City}} — but so is our commitment to sending {{3. Pizzas}} from {{2. Restaurant}}!",
  "making sure the long line at {{2. Location Address}} {{2. Location City}} is a little bit easier (and a lot more delicious) with {{3. Pizzas}} from {{2. Restaurant}}",
  "to the line at {{2. Location Address}} in {{2. Location City}}: we see you, we appreciate you, and we're sending {{3. Pizzas}} from {{2. Restaurant}} right now!",
  "your vote is powerful. your cravings are also powerful. we're supporting both at {{2. Location Address}} {{2. Location City}} with {{3. Pizzas}} from {{2. Restaurant}}",
  "voters of {{2. Location City}} — thank you for showing up at {{2. Location Address}}! enjoy {{3. Pizzas}} from {{2. Restaurant}} on us 🗳️🍕",
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
