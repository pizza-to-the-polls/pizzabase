import { validateReport } from ".";

jest.mock("./normalizeAddress");

test("validateReport returns an error for not valid requests", async () => {
  const { errors } = await validateReport({
    url: "not-valid",
    contact: "not-valid",
    address: "not-valid",
  });

  expect(errors).toEqual({
    url: "Invalid URL - please supply a valid URL",
    contact: "Invalid contact - please supply an email address or phone number",
    address: "Invalid address - please supply a valid address",
  });
});

test("validateReport returns an error for empty request", async () => {
  const { errors } = await validateReport({});

  expect(errors).toEqual({
    url: "Invalid URL - please supply a valid URL",
    contact: "Invalid contact - please supply an email address or phone number",
    address: "Invalid address - please supply a valid address",
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
