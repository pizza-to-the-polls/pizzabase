import { validateReport } from ".";
import { ADDRESS_ERROR, URL_ERROR, CONTACT_ERROR } from "./constants";

jest.mock("./normalizeAddress");

test("validateReport returns an error for not valid requests", async () => {
  const { errors } = await validateReport({
    url: "not-valid",
    contact: "not-valid",
    address: "not-valid",
  });

  expect(errors).toEqual({
    url: URL_ERROR,
    contact: CONTACT_ERROR,
    address: ADDRESS_ERROR,
  });
});

test("validateReport returns an error for empty request", async () => {
  const { errors } = await validateReport({});

  expect(errors).toEqual({
    url: URL_ERROR,
    contact: CONTACT_ERROR,
    address: ADDRESS_ERROR,
  });
});

test("validates the request is valid", async () => {
  expect(
    await validateReport({
      url: "http://twitter.com/something/?utm_diff",
      contact: "555-234-2345",
      address: "5335 S Kimbark Ave Chicago IL 60615",
    })
  ).toEqual({
    errors: {},
    reportURL: "http://twitter.com/something/",
    contactInfo: "555-234-2345",
    normalizedAddress: {
      latitude: 1234,
      longitude: -1234,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    },
  });
});
