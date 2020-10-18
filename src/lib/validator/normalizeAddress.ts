import * as SmartyStreetsSDK from "smartystreets-javascript-sdk";
import { toStateName } from "../states";
import fetch from "node-fetch";

const SmartyStreetsCore = SmartyStreetsSDK.core;
const Lookup = SmartyStreetsSDK.usExtract.Lookup;

const authId = process.env.SS_AUTH_ID;
const authToken = process.env.SS_AUTH_TOKEN;
const credentials = new SmartyStreetsCore.StaticCredentials(authId, authToken);
const client = SmartyStreetsCore.buildClient.usExtract(credentials);

const gmapsKey = process.env.GOOGLE_MAPS_KEY;
const gmapsURL = "https://maps.googleapis.com/maps/api/geocode/json";
const componentMapping = {
  locality: "city",
  postal_code: "zip",
  route: "street",
  street_number: "num",
  administrative_area_level_1: "state",
};

export interface NormalAddress {
  latitude: number;
  longitude: number;

  fullAddress: string;

  address: string;
  city: string;
  state: string;
  zip: string;
}

const geocode = async (body: string): Promise<null | NormalAddress> =>
  (await smartyGeocode(body)) || (await gmapsGeocode(body));

const gmapsGeocode = async (body: string): Promise<null | NormalAddress> => {
  const resp = await fetch(`${gmapsURL}?key=${gmapsKey}&address=${body}`);
  const { results } = await resp.json();
  const [result] = results || [];

  if (result) {
    const {
      geometry: {
        location: { lat: latitude, lng: longitude },
      },
      address_components,
    } = result;

    const { city, state, zip, num, street } = address_components.reduce(
      (obj, { short_name, types }) => {
        if (componentMapping[types[0]]) {
          obj[componentMapping[types[0]]] = short_name;
        }
        return obj;
      },
      {}
    );

    if (!num || !street || !city || !state || !zip) {
      return null;
    }

    const address = `${num} ${street}`;
    const fullAddress = `${address} ${city} ${state} ${zip}`;

    return {
      fullAddress,
      address,
      city,
      state,
      zip,
      latitude,
      longitude,
    };
  }
  return null;
};

const smartyGeocode = async (body: string): Promise<null | NormalAddress> => {
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
      components: { cityName: city, state, zipCode: zip },
    } = candidate;

    if (!toStateName(state)) return null;

    const fullAddress = `${address} ${city} ${state} ${zip}`;

    return {
      fullAddress,
      address,
      city,
      state,
      zip,
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
