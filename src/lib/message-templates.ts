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

export const TEMPLATES: readonly string[] = [
  "A line at a polling place? Unpossible!\n\nWe're choo choo choosing to send {{3. Pizzas}} from {{2. Restaurant}} to {{2. Location City}} {{2. Location State}} to help",
  "HERE COMES DAT PIZZA ( {{3. Pizzas}} from {{3. Restaurant}} )\n\nO shit waddup {{2. Location City}}, {{2. Location State Name}}",
  "There Are Pizzas Everywhere For Those With The Eyes To See 🍕 ✨ 👀\n\nBut less cryptically and more specifically there's {{3. Pizzas}} from {{2. Restaurant}} for {{2. Location Address}} headed to {{2. Location City}} {{2. Location State}} cause they've got a line at their polling place",
  "_________________________________________\n{{3. Pizzas}} from {{2. Restaurant}} are headed to {{2. Location Address}} in {{2. Location City}}\n-----------------------------------------\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )/\\\n                ||----w |\n                ||     || We asked ChatGPT to write one - how'd it do?",
  "Brace yourselves, {{2. Location City}}. {{3. Pizzas}} from {{2. Restaurant}} are coming to {{2. Location Address}}! Keep calm and pizza on. 🍕🗳️ #WinterIsVoting #MemesAndMozzarella",
  "╱|、\n{{3. Pizzas}} (˚ˎ 。7     from {{2. Restaurant}}\n|、˜〵      for {{2. Location City}}\nじしˍ,)ノ delivered right MEOW",
  "\\|/               (__)     Mooooove over \n      `\\------(oo) {{2. Location State Name}} ||        (__)              we've got {{3. Pizzas}} ||w--||         \\|/         from \n\\|/ {{2. Restaurant}}",
  "A line at {{2. Location City}}? Not very demure, not very mindful. Maybe {{3. Pizzas}} from {{3. Restaurant}} will help",
  "Hey {{2. Location City}} - hear you've got a line at {{2. Location Address}}. Here's {{3. Pizzas}} from {{3. Restaurant}}",
  "Got a report 📲 of a line at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}. Phoning in {{3. Pizzas}} from {{3. Restaurant}}",
  "Somebody need a 🍕 at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}? Howabout {{3. Pizzas}} from {{3. Restaurant}}",
  "👑\n🍕 🍕\n👁  👁👂\n   👃  \n   👄 - Oh? They need pizza at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}? Here's {{3. Pizzas}} from {{3. Restaurant}}",
  "|￣￣￣￣￣￣|\n| {{3. Pizzas}} |  from {{3. Restaurant}} |\n|  FOR             |\n| {{2. Location City}}, {{2. Location State Name}} | ＿＿＿＿＿__|\n(\\__/|| \n(•ㅅ•) || \n/   づ",
  "/)-/)         Tall order of {{3. Pizzas}}\n(* •• \\       / to {{2. Location Address}}\n/ (*   *)  /\n    /o / uu\n  /O/\n/o /\n 0/\n /  from {{3. Restaurant}} near {{2. Location City}} {{2. Location State Name}}",
  "♪♬  ON MY WAY  ᕕ(⌐■_■)ᕗ  ♪♬ \n\n♪♬  TO DELIVER {{3. Pizzas}} ♪♬ \n♪♬ FROM {{3. Restaurant}} ♪♬ \n\n♪♬  TO {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "Oh {{2. Location Address}} {{2. Location City}} {{2. Location State Name}} 🍕🍕\n┬──┬◡ﾉ(° -°ﾉ) {{3. Pizzas}} coming atcha!\n\nʕノ•ᴥ•ʔノ ︵ ┻━┻    🍕🍕\n\nfrom {{3. Restaurant}}",
  "{\\__/}\n( • . •)\n/ > 🗳  psst. look at this polling place at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}\n{\\__/}\n(ò . ó)\n/ > 🗳  𝐖𝐄 𝐒𝐄𝐍𝐓 𝐈𝐓 {{3. Pizzas}} pizzas (from {{3. Restaurant}})",
  "{{2. Location Address}} {{2. Location City}} {{2. Location State Name}}\n┻┳|\n┳┻|\n┻┳|\n┳┻| _\n┻┳| •.•) We just sent \n┳┻|⊂ﾉ {{3. Pizzas}}\n┻┳|      from {{3. Restaurant}}",
  "⊂_ヽ\n    ＼＼ Λ＿Λ\n      ＼( ˇωˇ)\n        /    ⌒\n     /        へ＼\n   /     / ＼＼\n  ﾚ ノ  ヽ_つ\n  / /   Sent {{3. Pizzas}}\n( (ヽ from {{3. Restaurant}}\n| |   、\\ to {{2. Location Address}}\n| 丿     ＼ {{2. Location City}}\n| |   ) /\nノ )  Lﾉ",
  "Checking our list (twice) but we hear lines aren't nice at {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}\n    🍕\n    🎄\n   🎄🎄\n  🎄⁣🎄🎄\n 🎄🎄🎄🎄\n🎄🎄🎄🎄🎄\n  🗳🗳🗳\n\n(check under your tree - it's {{3. Pizzas}} fresh pies from {{3. Restaurant}} 🎅!)",
  "*Phew* Sent {{3. Pizzas}} _from_ {{3. Restaurant}} -to- {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}.  ∧ ∧\n (´･ω･)  =3 phew\n /  ⌒ヽ\n(人＿＿つ_つ",
  ".iVVVVVVVi\n.|               |   \n.|               |\n.|      (O) (O)\nC              _)\n.|          ,_|    Aye carumba! - {{3. Pizzas}}\n.|              /  from {{3. Restaurant}}\n.|           /  to {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "┏┓┏┓｡･ﾟﾟ･｡｡ﾟ💖\n┃┗┛ appy💜\n┃┏┓┃ {{3. Pizzas}} ✿\n┗┛┗┛ day*ﾟ✾\n｡.｡.｡.｡💛  from {{3. Restaurant}} for {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "CRANK THAT DIAL, {{3. Pizzas}} :     .ılı.——Pizza——.ılı.\n:    ▄ █ ▄ █ ▄ ▄ █ ▄ █ ▄ █\n: Min- – – – – – – – – -●Max\nLOUD AND HOT FROM {{3. Restaurant}} 🔊 {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "Read my lips {{3. Pizzas}} from {{3. Restaurant}} ✌(-‿ -)✌\n          |\n          ^\n\nFor {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "⠀       ＿＿\n    ／＞ 🍕フ\n   |   _  _ l  ~ teleporting ~\n    ／` ミ＿xノ  ~ {{3. Pizzas}} ~\n Query /      |    ~ from {{3. Restaurant}} ~\n   /  ヽ dry ﾉ   \n   │ |||n／￣|   |||n| (￣ヽ＿_ヽ_)__)\n＼二つ to {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "{{3. Pizzas}}?\n        ∧＿∧ \n      (´･ω･)\n| ⌒Ｙ⌒ / /\n\\ヽ    ｜   ﾉ／\n ＼ ﾄー🍕ーｲ /\n  ｜  ミ土彡 ｜\n   \nABS-OLUTELY - ♨️ from {{3. Restaurant}} for {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "(•_•)\n<)   )╯ {{3. Pizzas}} /    \\\n\n\\(•_•)\n(   (>  from {{3. Restaurant}} /    \\\n\n (•_•)\n<)   )>  have been sent!\n/    \\\n\nTo {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}",
  "{{2. Location Address}} {{2. Location City}} {{2. Location State Name}} 。☆。*。☆。\n★。＼｜／。★\n♥----- ^_^.----♥\n★。／｜＼。★\n.。☆。*。☆.¸¸.•*'*•.★\n*♥ {{3. Pizzas}} *☆  on the way  ♥*\nfrom {{3. Restaurant}}",
  "⠀         (\\__/) {{3. Restaurant}}    ⠀  (•ㅅ• )        delivering {{3. Pizzas}}  ＿ノ ヽ ノ＼  __  for {{2. Location City}} {{2. Location State}}\n/ `/ ⌒Ｙ⌒ Ｙ ヽ    \n(  (三ヽ人  /   |     \n| ﾉ⌒＼ ￣￣ヽ  ノ    \nヽ＿＿＿＞､＿＿_／ \n   ｜( 王 ﾉ〈   (\\__/)\n   /ﾐ`ー―彡\\  (•ㅅ•) our democracy",
  "ACCIO PIZZA (∩ ͡° ͜ʖ ͡°)⊃━☆ﾟ. ****  🍕\n\n🧙‍♂️ {{3. Pizzas}} from {{3. Restaurant}}🧙‍♀️\n🦉 to {{2. Location Address}} {{2. Location City}} {{2. Location State Name}} 🧹",
  "🍕🍕 ┻━┻︵ \\(°□°)/ ︵ ┻━┻  🍕🍕 {{3. Pizzas}} is thusly thrown from {{3. Restaurant}}",
  "⠀     🤠\n    🍕🍕🍕\n   👇 🍕 👇\n    🍕 🍕\n   🍕  🍕\n   👢      👢\nhowdy {{2. Location Address}} {{2. Location City}} {{2. Location State Name}} I'm the pizza sheriff and uv got {{3. Pizzas}} from {{3. Restaurant}}",
  "Have a pizza my heart 😻 {{2. Location Address}} {{2. Location City}} {{2. Location State Name}} Or really {{3. Pizzas}} from {{3. Restaurant}}",
  "Slice to meet you {{2. Location Address}} {{2. Location City}} {{2. Location State Name}}! Enjoy {{3. Pizzas}} from {{3. Restaurant}}",
];

function selectTemplate(): string {
  return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
}

function typeLabel(orderType: string): string {
  if (orderType === OrderTypes.pizzas) return "pizzas";
  if (orderType === OrderTypes.donuts) return "dozen donuts";
  return orderType;
}

/**
 * Render a randomly-selected message template with order data.
 *
 * All placeholders ({{2. Location City}}, {{3. Pizzas}}, etc.) are replaced
 * with values from the order. Dangling "from " fragments are cleaned up when
 * the restaurant is empty.
 */
export function renderMessage(order: MessageOrder): string {
  const template = selectTemplate();
  const fullStateName =
    toStateName(order.location.state.toUpperCase()) ?? order.location.state;
  const label = typeLabel(order.orderType);
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

  return text;
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
