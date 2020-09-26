import * as SmartyStreetsSDK from "smartystreets-javascript-sdk";

const SmartyStreetsCore = SmartyStreetsSDK.core;
const Lookup = SmartyStreetsSDK.usExtract.Lookup;

const authId = process.env.SS_AUTH_ID;
const authToken = process.env.SS_AUTH_TOKEN;
const credentials = new SmartyStreetsCore.StaticCredentials(authId, authToken);

let client = SmartyStreetsCore.buildClient.usExtract(credentials);

export interface NormalAddress {
  latitude: number;
  longitude: number,

  fullAddress: string;

  address: string;
  city: string;
  state: string;
  zipCode: string;
}

const geocode = async (body: string) : null | normalizedAddress => {
  const lookup = new Lookup(body);
  lookup.aggressive = true;

  try {
    const resp = await client.send(lookup);
  } catch (e) {
    console.error(e)
  }

  const { addresses } = result || {};

  const [ addy ] = addresses || [];
  const { candidates } = addy || {};
  const [ candidate ] = candidates || {};

  if( candidate ) {
    const {
      deliveryLine1: address,
      metadata: { latitude, longitude },
      components: {
        city,
        state,
        zipCode
      }
    } = candidate;

    const fullAddress = `${address} ${city} ${state} ${zipCode}`

    return {
      fullAddress,
      address,
      city,
      state,
      zipCode,
      latitude,
      longitude,
    }
  }
}

export const normalizeAddress = async (address?: string) : NormalAddress | null  => (
  address ? (await geocode(address)) : null
)
