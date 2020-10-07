import { NormalAddress } from "../";

export const normalizeAddress = async (
  fullAddress?: string
): Promise<NormalAddress | null> => {
  if (!fullAddress) {
    return null;
  }
  const [zip, state, city, ...address] = fullAddress.split(" ").reverse();

  if (!zip || !state || !city || !address) return null;

  return {
    latitude: 1234,
    longitude: -1234,

    fullAddress,
    address: address.reverse().join(" "),
    city,
    state,
    zip,
  };
};
