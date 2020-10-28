import { validateReport } from ".";
import { ADDRESS_ERROR, URL_ERROR, CONTACT_ERROR } from "./constants";

jest.mock("./geocode");

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

test("can override invalid", async () => {
  const {
    errors,
    contactRole,
    normalizedAddress,
    contactInfo,
    reportURL,
  } = await validateReport(
    {
      address: "not-valid",
      addressOverride: {
        address: "address",
        city: "city",
        state: "OR",
        latitude: "420",
        longitude: "-420",
        zip: "zip",
      },
    },
    true
  );
  expect(errors).toEqual({});
  expect(reportURL).toContain("http://trusted.url");
  expect(contactInfo).toEqual("trusted@example.com");
  expect(normalizedAddress).toEqual({
    latitude: 420,
    longitude: -420,

    fullAddress: "address city OR zip",

    address: "address",
    city: "city",
    state: "OR",
    zip: "zip",
  });
  expect(contactRole).toEqual("Trusted");
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
  const {
    errors,
    reportURL,
    contactInfo,
    normalizedAddress,
  } = await validateReport({
    url: "http://twitter.com/something/?utm_diff",
    contact: "555-234-2345",
    address: "5335 S Kimbark Ave Chicago IL 60615",
  });

  expect(errors).toEqual({});
  expect(reportURL).toEqual("http://twitter.com/something/");
  expect(contactInfo).toEqual("555-234-2345");
  expect(normalizedAddress).toEqual({
    latitude: 1234,
    longitude: -1234,

    fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

    address: "5335 S Kimbark Ave",
    city: "Chicago",
    state: "IL",
    zip: "60615",
  });
});
