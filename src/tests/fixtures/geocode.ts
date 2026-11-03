/**
 * BUG-037 repro fixtures — the exact address strings that were reproduced
 * live against prod /upload on 2026-11-03 (issue #400), grouped by the
 * geocoder outcome observed for each.
 *
 * The geocode module (`src/lib/validator/geocode.ts`) returns `null` unless
 * the Google Maps result carries street_number+route (or premise) AND city
 * AND state AND zip — so locality-only picks and route-level partial matches
 * normalize to `null`. These fixtures drive the regression tests that pin
 * `null` as a non-error for photo uploads. Geocode is stubbed at runtime
 * (see `stubGeocode` below); no network calls.
 */

import { NormalAddress } from "../../lib/validator";

/** Locality-only picks the Google Places autocomplete offers on /report. */
export const LOCALITY_ONLY_ADDRESSES = [
  "Miami, FL, USA",
  "Broward County, FL, USA",
  "Central Park, New York, NY, USA",
];

/**
 * Partial-match street address: a wrong/new street number yields a
 * route-level geocode with no street_number component → null.
 */
export const PARTIAL_MATCH_ADDRESS =
  "123 Main Street, Brookings, SD 57006, USA";

/** Everything the geocoder refuses to normalize to a full street address. */
export const UNNORMALIZABLE_ADDRESSES: string[] = [
  ...LOCALITY_ONLY_ADDRESSES,
  PARTIAL_MATCH_ADDRESS,
];

/** A rooftop-precise address that normalizes to a full NormalAddress. */
export const FULL_STREET_ADDRESS =
  "1 Veterans Pl, Silver Spring, MD 20910, USA";

export const FULL_STREET_NORMALIZED: NormalAddress = {
  latitude: 38.99161,
  longitude: -77.02872,
  fullAddress: "1 Veterans Pl Silver Spring MD 20910",
  address: "1 Veterans Pl",
  city: "Silver Spring",
  state: "MD",
  zip: "20910",
  county: "Montgomery County",
};

/**
 * Replace the geocode module's `geocode` export with a stub (same runtime
 * swap pattern used for GeocodingError rejections in the controller tests —
 * named imports compile to property accesses, so the swap is picked up).
 *
 * Returns a restore function; the controllers/tests in this suite typically
 * call it in `afterEach`.
 */
export const stubGeocode = (
  impl: (
    address?: string,
  ) => NormalAddress | null | Promise<NormalAddress | null>,
): (() => void) => {
  const geocodeModule = require("../../lib/validator/geocode");
  const original = geocodeModule.geocode;
  geocodeModule.geocode = jest.fn(impl);
  return () => {
    geocodeModule.geocode = original;
  };
};

/** Swap in a geocode that always fails normalization (null) — never throws. */
export const stubGeocodeUnnormalizable = (): (() => void) =>
  stubGeocode(async () => null);

/** Swap in a geocode that fails with the system-level GeocodingError. */
export const stubGeocodeFailure = (message: string): (() => void) =>
  stubGeocode(async () => {
    const { GeocodingError } = require("../../lib/validator/geocode");
    throw new GeocodingError(message);
  });
