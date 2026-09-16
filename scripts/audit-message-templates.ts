/**
 * Whitespace & art-safety evaluator for social message templates (issue #223).
 *
 * Twitter/X, Threads, and BlueSky render posts in proportional fonts and
 * collapse runs of regular whitespace. Two consequences:
 *
 *   1. Whitespace compression — runs of spaces (art indentation) vanish.
 *      Fixed at render time by converting intentional spacing to NBSP
 *      (see preserveWhitespace in src/lib/message-templates.ts).
 *   2. Proportional fonts — cross-line column alignment is impossible, so
 *      templates must not depend on it (boxes, inline art next to
 *      variable-length content).
 *
 * This script renders every template with a matrix of order shapes (short /
 * medium / long / edge-case) and lints the results:
 *
 *   R1 boxed-content   — placeholder between pipes/border chars on one line
 *   R2 multiline-box   — box top-border (`￣`, `┏`, `───`) plus content lines
 *                         that rely on vertical alignment
 *   R3 art-inline       — placeholder on a line with 2+ pipes or a border
 *                         run (≥3 of ─━═┅┉) — art that a variable-length
 *                         value will tear apart
 *   R4 overflow         — rendered length exceeds the platform limit
 *   R5 leftover         — unreplaced placeholder after render
 *   R6 whitespace       — rendered output still contains compressible
 *                         runs of regular spaces (NBSP conversion missed)
 *
 * Usage:
 *   npx ts-node scripts/audit-message-templates.ts          # lint summary
 *   npx ts-node scripts/audit-message-templates.ts --show  # print renders
 *   npx ts-node scripts/audit-message-templates.ts --show --mark
 *         # --mark renders NBSP as '·' and U+2800 as '░' to verify spacing
 */
import {
  TEMPLATES,
  renderTemplate,
  MAX_BLUESKY_LENGTH,
  MAX_TWEET_LENGTH,
  MessageOrder,
} from "../src/lib/message-templates";

const SHAPES: { name: string; order: MessageOrder }[] = [
  {
    name: "short",
    order: {
      quantity: 2,
      orderType: "pizzas",
      restaurant: "Domino's",
      location: { city: "Dover", state: "DE", address: "1 Main St" },
    },
  },
  {
    name: "medium",
    order: {
      quantity: 10,
      orderType: "pizzas",
      restaurant: "Papa John's",
      location: { city: "Portland", state: "OR", address: "123 Main St" },
    },
  },
  {
    name: "long",
    order: {
      quantity: 24,
      orderType: "pizzas",
      restaurant: "Antonio's Pizza & Pasta Kitchen",
      location: {
        city: "Rancho Santa Margarita",
        state: "DC",
        address: "1600 Pennsylvania Avenue Northwest",
      },
    },
  },
  {
    name: "solo-no-restaurant",
    order: {
      quantity: 1,
      orderType: "pizzas",
      restaurant: null,
      location: { city: "Eek", state: "AK", address: "42 North Ln" },
    },
  },
  {
    name: "donuts",
    order: {
      quantity: 5,
      orderType: "dozen donuts",
      restaurant: "Krispy Kreme",
      location: { city: "Chicago", state: "IL", address: "456 Oak Ave" },
    },
  },
  {
    name: "huge",
    order: {
      quantity: 100,
      orderType: "pizzas",
      restaurant: "Giordano's Famous Chicago Deep Dish",
      location: {
        city: "Thompson Springs",
        state: "UT",
        address: "789 West Martin Luther King Boulevard",
      },
    },
  },
];

interface Violation {
  rule: string;
  detail: string;
}

const BORDER_CHARS = "─━═┅┉";
const BOX_SIDES = /[│┃┠┨┞┧├┤]/;

function hasBorderRun(line: string): boolean {
  for (const ch of BORDER_CHARS) {
    let run = 0;
    for (const c of line) {
      run = c === ch ? run + 1 : 0;
      if (run >= 3) return true;
    }
  }
  return false;
}

function pipeCount(line: string): number {
  return (line.match(/\|/g) || []).length;
}

function lintTemplate(source: string, renders: string[]): Violation[] {
  const issues: Violation[] = [];

  for (const line of source.split("\n")) {
    const placeholder = /\{\{.*?\}\}/.test(line);
    if (!placeholder) continue;

    // R1: placeholder between pipes (| … |) on a single line
    if (/\|[^|\n]*\{\{[^}]*\}\}[^|\n]*\|/.test(line)) {
      issues.push({ rule: "R1 boxed-content", detail: line.trim() });
    }
    // R3: placeholder next to multi-pipe or border-run art
    if (
      (pipeCount(line) >= 2 || hasBorderRun(line) || BOX_SIDES.test(line)) &&
      placeholder
    ) {
      issues.push({ rule: "R3 art-inline", detail: line.trim() });
    }
  }

  // R2: a box top-border line (￣ table, ┏ corners, ─── rules) above lines
  // that carry placeholders — vertical alignment required
  const lines = source.split("\n");
  const boxTop = /￣|┏|─{3,}|━{3,}/;
  const sawBox = lines.some((l) => boxTop.test(l) && !/\{\{.*?\}\}/.test(l));
  if (sawBox) {
    const contentInBox = lines.some(
      (l) =>
        /\{\{.*?\}\}/.test(l) &&
        (BOX_SIDES.test(l) || /￣/.test(l) || hasBorderRun(l)),
    );
    if (contentInBox) {
      issues.push({
        rule: "R2 multiline-box",
        detail: "box art with variable content",
      });
    }
  }

  // R4/R5/R6 on rendered output
  for (let i = 0; i < renders.length; i++) {
    const r = renders[i];
    if (/\{\{.*?\}\}/.test(r)) {
      issues.push({ rule: "R5 leftover", detail: SHAPES[i].name });
    }
    if (r.length > MAX_TWEET_LENGTH) {
      issues.push({
        rule: "R4 overflow",
        detail: `${SHAPES[i].name}: ${r.length} > ${MAX_TWEET_LENGTH} (twitter)`,
      });
    } else if (r.length > MAX_BLUESKY_LENGTH) {
      issues.push({
        rule: "R4 overflow",
        detail: `${SHAPES[i].name}: ${r.length} > ${MAX_BLUESKY_LENGTH} (bluesky)`,
      });
    }
    if (/ {2,}/.test(r) || /^ /m.test(r)) {
      issues.push({
        rule: "R6 whitespace",
        detail: `${SHAPES[i].name}: compressible regular spaces survive render`,
      });
    }
  }
  return issues;
}

function mark(text: string): string {
  return text
    .replace(/\u00a0/g, "·")
    .replace(/\u2800/g, "░")
    .replace(/ /g, "·")
    .replace(/\u3000/g, "█");
}

const show = process.argv.includes("--show");
const showMarked = process.argv.includes("--mark");
const onlyIssues = process.argv.includes("--issues");

const allIssues = new Map<number, Violation[]>();

for (let i = 0; i < TEMPLATES.length; i++) {
  const renders = SHAPES.map((s) => renderTemplate(TEMPLATES[i], s.order));
  const issues = lintTemplate(TEMPLATES[i], renders);
  if (issues.length) allIssues.set(i, issues);

  if (show || (!onlyIssues && issues.length)) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`TEMPLATE ${i}${issues.length ? "  ✗" : "  ✓"}`);
    if (issues.length) {
      for (const v of issues) console.log(`  ${v.rule}: ${v.detail}`);
    }
    if (show) {
      console.log(`--- rendered with "${SHAPES[1].name}" order ---`);
      console.log(renders[1]);
      console.log(`--- rendered with "${SHAPES[2].name}" order ---`);
      console.log(showMarked ? mark(renders[2]) : renders[2]);
      console.log(`--- rendered with "${SHAPES[3].name}" order ---`);
      console.log(showMarked ? mark(renders[3]) : renders[3]);
      console.log(
        `(lengths: ${SHAPES.map((s, j) => `${s.name}=${renders[j].length}`).join(" ")})`,
      );
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(
  `SUMMARY: ${TEMPLATES.length} templates, ${allIssues.size} flagged (${
    [...new Set([...allIssues.values()].flat().map((v) => v.rule))].join(
      ", ",
    ) || "no issues"
  })`,
);
if (allIssues.size === 0) console.log("ALL CLEAR ✓");
