import dbHelper from "./dbHelper";
import { APIKey } from "../entity/APIKey";

beforeAll(async () => {
  await dbHelper.setUpDB();

  process.env.ZAP_NEW_REPORT = "https://hooks.example.com/new-report-hook/";
  process.env.ZAP_NEW_LOCATION = "https://hooks.example.com/new-location-hook/";
});
beforeEach(async () => {
  process.env.GOOD_API_KEY = (await APIKey.generate()).key;
});
afterEach(async () => {
  await dbHelper.cleanAll();
});
afterAll(async () => {
  await dbHelper.closeDB();
});
