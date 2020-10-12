import dbHelper from "./dbHelper";

beforeAll(async () => {
  await dbHelper.setUpDB();

  process.env.ZAP_NEW_REPORT = "https://hooks.example.com/new-report-hook/";
  process.env.ZAP_NEW_LOCATION = "https://hooks.example.com/new-location-hook/";
});
afterEach(async () => {
  await dbHelper.cleanAll();
});
afterAll(async () => {
  await dbHelper.closeDB();
});
