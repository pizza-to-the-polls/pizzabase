import { Location } from "../entity/location";

const TRUCK_RANGE = 50; // in miles

const TRUCK_CONFIG: {
  [state: string]: {
    dates: {
      [date: string]: { lat: number; lng: number; citystate: string }[];
    };
  };
} = [
  {
    state: "AZ",
    citystate: "phoenix-az",
    loc: { lat: 33.44731, lng: -112.0687 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "CA",
    citystate: "losangeles-ca",
    loc: { lat: 33.91663, lng: -118.06794 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "DC",
    citystate: "washington-dc",
    loc: { lat: 38.92529, lng: -77.03479 },
    dates: [
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "FL",
    citystate: "miami-fl",
    loc: { lat: 25.83238, lng: -80.18667 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-03",
    ],
  },
  {
    state: "FL",
    citystate: "tampa-fl",
    loc: { lat: 27.89374, lng: -82.25503 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-03",
    ],
  },
  {
    state: "FL",
    citystate: "orlando-fl",
    loc: { lat: 28.60512, lng: -81.20447 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-03",
    ],
  },
  {
    state: "FL",
    citystate: "gainesville-fl",
    loc: { lat: 29.62848, lng: -82.42246 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-03",
    ],
  },
  {
    state: "GA",
    citystate: "atlanta-ga",
    loc: { lat: 33.75413, lng: -84.49179 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "KY",
    citystate: "louisville-ky",
    loc: { lat: 38.2561282, lng: -85.756658 },
    dates: ["2020-10-24", "2020-11-03"],
  },
  {
    state: "MI",
    citystate: "detroit-mi",
    loc: { lat: 42.36824, lng: -83.07815 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "MI",
    citystate: "annarbor-mi",
    loc: { lat: 42.27476, lng: -83.74059 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "MN",
    citystate: "minneapolis-mn",
    loc: { lat: 44.9914, lng: -93.24013 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "NC",
    citystate: "charlotte-nc",
    loc: { lat: 35.30462, lng: -80.72619 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-03",
    ],
  },
  {
    state: "NC",
    citystate: "raleigh-nc",
    loc: { lat: 35.80129, lng: -78.80692 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-03",
    ],
  },
  {
    state: "NC",
    citystate: "greensboro-nc",
    loc: { lat: 36.05661, lng: -79.74938 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-03",
    ],
  },
  {
    state: "NV",
    citystate: "lasvegas-nv",
    loc: { lat: 36.22545, lng: -115.17402 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "NV",
    citystate: "reno-nv",
    loc: { lat: 39.54412, lng: -119.75874 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "NY",
    citystate: "newyork-ny",
    loc: { lat: 40.835415, lng: -73.8627648 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-03",
    ],
  },
  {
    state: "PA",
    citystate: "philadelphia-pa",
    loc: { lat: 39.97981, lng: -75.15853 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "PA",
    citystate: "pittsburgh-pa",
    loc: { lat: 40.44291, lng: -79.95682 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "SC",
    citystate: "charleston-sc",
    loc: { lat: 32.78857, lng: -79.93116 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-03",
    ],
  },
  {
    state: "TN",
    citystate: "nashville-tn",
    loc: { lat: 36.21349, lng: -86.83803 },
    dates: ["2020-10-24", "2020-10-29", "2020-11-03"],
  },
  {
    state: "TX",
    citystate: "houston-tx",
    loc: { lat: 29.7246, lng: -95.36265 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "TX",
    citystate: "austin-tx",
    loc: { lat: 30.27319, lng: -97.70949 },
    dates: ["2020-10-24", "2020-10-29", "2020-10-30", "2020-11-03"],
  },
  {
    state: "WI",
    citystate: "milwaukee-wi",
    loc: { lat: 43.089892, lng: -87.9878195 },
    dates: [
      "2020-10-24",
      "2020-10-29",
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-03",
    ],
  },
  {
    state: "MD",
    citystate: "washington-dc",
    loc: { lat: 38.92529, lng: -77.03479 },
    dates: [
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
  {
    state: "VA",
    citystate: "washington-dc",
    loc: { lat: 38.92529, lng: -77.03479 },
    dates: [
      "2020-10-30",
      "2020-10-31",
      "2020-11-01",
      "2020-11-02",
      "2020-11-03",
    ],
  },
].reduce((obj, { state, dates, loc, citystate }) => {
  const config = obj[state] || { dates: {} };

  dates.forEach((date) => {
    const dateConfig = config.dates[date] || [];
    dateConfig.push({ ...loc, citystate });
    config.dates[date] = dateConfig;
  });

  obj[state] = config;
  return obj;
}, {});

const distance = (lat1, lng1, lat2, lng2) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a =
    0.5 -
    c((lat2 - lat1) * p) / 2 +
    (c(lat1 * p) * c(lat2 * p) * (1 - c((lng2 - lng1) * p))) / 2;

  return (12742 * Math.asin(Math.sqrt(a))) / 1.609344;
};

export const truckEligibility = (
  location: Location,
  now: Date
): null | { citystate: string; date: string } => {
  const { state } = location;
  const repLat = Number(location.lat);
  const repLng = Number(location.lng);

  const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const { dates } = TRUCK_CONFIG[state] || {};

  if (!dates) return null;
  const citystates = dates[date];

  if (!citystates) return null;

  const { citystate } =
    citystates.find(
      ({ lat, lng }) => distance(repLat, repLng, lat, lng) <= TRUCK_RANGE
    ) || {};

  return !!citystate ? { citystate, date } : null;
};
