If you need to upload old deliveries to the delivery page run this script:

`npx ts-node scripts/uploadPreorder.ts path-to-file.csv`

For more information on what the CSV should have in it for this to work you can look at the top of the `uploadPreorder.ts` file. Rigth now, the `/deliveries` page will only show the last 3 deliveries. So if you only see 3 deliveries but you know you uploaded more, that is probably why.

## audit-message-templates.ts

Lints and renders every social message template against the art-safety rules from issue #223 (proportional fonts + whitespace collapsing on Twitter/X, Threads, and BlueSky):

`npx ts-node scripts/audit-message-templates.ts` — lint summary (should print `ALL CLEAR ✓`)

`npx ts-node scripts/audit-message-templates.ts --show` — also print every template rendered with medium/long/edge-case orders

`npx ts-node scripts/audit-message-templates.ts --show --mark` — same, but renders non-breaking spaces as `·` so you can see exactly which spacing will survive platform rendering

The same rules run in CI via `src/lib/message-templates.test.ts`, so a template that violates them (box borders around variable content, art that variable-length values tear apart, over-length messages) fails the build.
