# Pizza Base

The HQ for Pizza to the Polls. Powering our admin API... and other things.

# Getting Started

1. Install dependencies `npm i`

1. Make sure you've got postgres running locally with a user and a db

1. Copy `ormconfig.json.example` to `ormconfig.json` and add your db/credentials

1. Run `npm run schema:sync` to set up the db

1. Run `npm run dev` to see it in action

1. To specify the database tests run against - specify env variables for `POSTGRES_DB`, `POSTGRES_USERNAME`, `POSTGRES_PASSWORD`

# Bulk Uploading

```bash
GOOGLE_MAPS_KEY=XXDX ts-node scripts/uploadPreorder.ts path/to/csv
```
