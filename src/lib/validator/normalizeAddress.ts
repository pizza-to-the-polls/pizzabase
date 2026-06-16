import { toStateName } from "../states";
import { geocode, GeocodingError } from "./geocode";
import { NormalAddress, OverrideAddress } from "./types";
import { notifyBugsnag } from "../notifyBugsnag";

const overrideAddress = (
  addressOverride: null | OverrideAddress
): NormalAddress | null => {
  const { address, city, state, zip, latitude, longitude } =
    addressOverride || {};

  if (!toStateName(state)) return null;
  if (address && city && state && zip && latitude && longitude) {
    return {
      fullAddress: `${address} ${city} ${state} ${zip}`,
      address,
      city,
      state,
      zip,
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
  }
  return null;
};

export const normalizeAddress = async (
  address?: string,
  addressOverride: null | OverrideAddress = null
): Promise<NormalAddress | null> => {
  try {
    return (
      (address ? await geocode(address) : null) ||
      overrideAddress(addressOverride)
    );
  } catch (e) {
    if (e instanceof GeocodingError) {
      // Re-throw so callers can distinguish system-level geocoding failures
      // from "address not found" (null return).
      notifyBugsnag(e);
      throw e;
    }
    // Log unexpected errors but still return null for backward-compat
    console.error(e);
    notifyBugsnag(e as Error);
    return null;
  }
};
