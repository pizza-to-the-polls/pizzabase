/**
 * Backfill location counties (FEAT-001 / Issue #216).
 *
 * Populates `locations.county` for existing rows by re-geocoding each
 * location's full address with Google Maps and storing the
 * `administrative_area_level_2` component (e.g. "Allegheny").
 *
 * Usage:
 *   NODE_ENV=development npx ts-node scripts/backfill-location-counties.ts
 *
 * Requires GOOGLE_MAPS_KEY in the environment.
 */
import { createConnection } from "typeorm";

import { geocode } from "../src/lib/validator/geocode";
import { Location } from "../src/entity/Location";

(async () => {
  await createConnection();

  if (!process.env.GOOGLE_MAPS_KEY) {
    console.error("GOOGLE_MAPS_KEY is not configured — aborting.");
    process.exit(1);
  }

  const locations = await Location.find({ where: { county: null } });
  console.log(`Backfilling county for ${locations.length} locations`);

  let updated = 0;
  let failed = 0;

  for (const location of locations) {
    try {
      const address = await geocode(location.fullAddress);

      if (address?.county) {
        location.county = address.county;
        await location.save();
        updated += 1;
      } else {
        failed += 1;
        console.log(
          `No county for location ${location.id}: ${location.fullAddress}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`Geocode failed for location ${location.id}: ${err}`);
    }

    // Stay well under the Google Maps API rate limits.
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`Done: ${updated} updated, ${failed} without county data`);
  process.exit(0);
})();
