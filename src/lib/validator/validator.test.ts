import test from "ava";

import { validateRequest } from ".";

test("validateRequest returns an error for not valid requests", async (t) => {
  const { errors } = await validateRequest({
    url: "not-valid",
    contact: "not-valid",
    address: "not-valid",
  });

  t.deepEqual(errors, {
    url: "Invalid URL - please supply a valid URL",
    contact: "Invalid contact - please supply an email address or phone number",
    address: "Invalid address - please supply a valid address",
  });
});

test("validateRequest returns an error for empty request", async (t) => {
  const { errors } = await validateRequest({});

  t.deepEqual(errors, {
    url: "Invalid URL - please supply a valid URL",
    contact: "Invalid contact - please supply an email address or phone number",
    address: "Invalid address - please supply a valid address",
  });
});

test("validates the request is valid", async (t) => {
  t.deepEqual(
    await validateRequest({
      url: "http://twitter.com/something/",
      contact: "555-234-2345",
      address: "5335 S Kimbark Ave, Chicago IL 60615",
    }),
    {
      errors: {},
      reportURL: "http://twitter.com/something/",
      contactInfo: "555-234-2345",
      normalizedAddress: {
        latitude: 41.79907,
        longitude: -87.58413,

        fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zipCode: "60615",
      },
    }
  );
});
