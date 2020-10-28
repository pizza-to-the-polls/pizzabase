import * as SmartyStreetsSDK from "smartystreets-javascript-sdk";
import { toStateName } from "../states";
import fetch from "node-fetch";

const SmartyStreetsCore = SmartyStreetsSDK.core;
const Lookup = SmartyStreetsSDK.usExtract.Lookup;

const authId = process.env.SS_AUTH_ID;
const authToken = process.env.SS_AUTH_TOKEN;
const credentials = new SmartyStreetsCore.StaticCredentials(authId, authToken);
const client = SmartyStreetsCore.buildClient.usExtract(credentials);

const GMAPS_KEY = process.env.GOOGLE_MAPS_KEY;
const GMAPS_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GMAPS_COMPONENT_MAPPING = {
  sublocality: "city",
  locality: "city",
  postal_code: "zip",
  route: "street",
  street_number: "num",
  administrative_area_level_1: "state",
};

import { NormalAddress } from "./types";

export const geocode = async (body: string): Promise<null | NormalAddress> =>
  (await smartyGeocode(body)) || (await gmapsGeocode(body));

const gmapsGeocode = async (body: string): Promise<null | NormalAddress> => {
  const resp = await fetch(
    `${GMAPS_URL}?key=${GMAPS_KEY}&address=${escape(body)}`
  );
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
        for (const type of types) {
          if (GMAPS_COMPONENT_MAPPING[type]) {
            obj[GMAPS_COMPONENT_MAPPING[type]] = short_name;
          }
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
