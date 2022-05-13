import fetch from "node-fetch";

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
  await gmapsGeocode(body);

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
