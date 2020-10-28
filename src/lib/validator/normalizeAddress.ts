import { toStateName } from "../states";
import { geocode } from "./geocode";
import { NormalAddress, OverrideAddress } from "./types";

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
    console.error(e);
  }
};
