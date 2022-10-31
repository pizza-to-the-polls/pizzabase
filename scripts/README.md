If you need to upload old deliveries to the delivery page run this script:

`npx ts-node scripts/uploadPreorder.ts path-to-file.csv`

For more information on what the CSV should have in it for this to work you can look at the top of the `uploadPreorder.ts` file. Rigth now, the `/deliveries` page will only show the last 3 deliveries. So if you only see 3 deliveries but you know you uploaded more, that is probably why.