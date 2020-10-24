import { truckEligibility } from "./trucks";
import { Location } from "../entity/Location";

it("returns truck details if within range", async () => {
  expect(
    truckEligibility(
      await Location.createFromAddress({
        fullAddress: "2222 W Braker Ln Austin TX 78758",
        latitude: 30.39276,
        longitude: -97.71284,
        state: "TX",
        city: "Austin",
        address: "2222 W Braker Ln",
        zip: "78758",
      }),
      new Date("10/24/2020")
    )
  ).toEqual({
    citystate: "austin-tx",
    date: "2020-10-24",
  });
});

it("returns false if not truck on date", async () => {
  expect(
    truckEligibility(
      await Location.createFromAddress({
        fullAddress: "2222 W Braker Ln Austin TX 78758",
        latitude: 30.39276,
        longitude: -97.71284,
        state: "TX",
        city: "Austin",
        address: "2222 W Braker Ln",
        zip: "78758",
      }),
      new Date("10/24/2000")
    )
  ).toEqual(false);
});

it("returns false if not in state", async () => {
  expect(
    truckEligibility(
      await Location.createFromAddress({
        fullAddress: "2222 W Braker Ln Austin OR 78758",
        latitude: 30.39276,
        longitude: -97.71284,
        state: "OR",
        city: "Austin",
        address: "2222 W Braker Ln",
        zip: "78758",
      }),
      new Date("10/24/2020")
    )
  ).toEqual(false);
});

it("returns false if not in range", async () => {
  expect(
    truckEligibility(
      await Location.createFromAddress({
        fullAddress: "2222 W Braker Ln Austin TX 78758",
        latitude: 35,
        longitude: -91,
        state: "TX",
        city: "Austin",
        address: "2222 W Braker Ln",
        zip: "78758",
      }),
      new Date("10/24/2020")
    )
  ).toEqual(false);
});
