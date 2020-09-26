import * as SmartyStreetsSDK from "smartystreets-javascript-sdk";

const SmartyStreetsCore = SmartyStreetsSDK.core;
const Lookup = SmartyStreetsSDK.usExtract.Lookup;

const authId = process.env.SS_AUTH_ID;
const authToken = process.env.SS_AUTH_TOKEN;
const credentials = new SmartyStreetsCore.StaticCredentials(authId, authToken);

let client = SmartyStreetsCore.buildClient.usExtract(credentials);

export interface NormalAddress {
  latitude: number;
  longitude: number;

  fullAddress: string;

  address: string;
  city: string;
  state: string;
  zipCode: string;
}

const geocode = async (body: string): Promise<null | NormalAddress> => {
  const lookup = new Lookup(body);
  lookup.aggressive = true;

  const { result } = await client.send(lookup);
  const { addresses } = result || { addresses: [] };
  const { candidates } = (addresses || [])[0] || { candidates: [] };
  const candidate = (candidates || [])[0];

  if (candidate) {
    const {
      deliveryLine1: address,
      metadata: { latitude, longitude },
      components: { cityName: city, state, zipCode },
    } = candidate;

    const fullAddress = `${address} ${city} ${state} ${zipCode}`;

    return {
      fullAddress,
      address,
      city,
      state,
      zipCode,
      latitude,
      longitude,
    };
  }

  return null;
};

export const normalizeAddress = async (
  address?: string
): Promise<NormalAddress | null> => {
  try {
    return address ? await geocode(address) : null;
  } catch (e) {
    console.error(e);
  }
};
