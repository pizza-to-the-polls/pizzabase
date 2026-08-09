import dbHelper from "./dbHelper";
import { APIKey } from "../entity/APIKey";

global.fetch = jest.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
) as jest.Mock;

beforeAll(async () => {
  // Set allowed origins for CORS testing — consumed when Express app is first loaded
  process.env.ALLOWED_ORIGINS = "polls.pizza";

  await dbHelper.setUpDB();

  process.env.ZAP_NEW_REPORT = "https://hooks.example.com/new-report-hook/";
  process.env.ZAP_NEW_LOCATION = "https://hooks.example.com/new-location-hook/";
  process.env.ZAP_SKIP_LOCATION =
    "https://hooks.example.com/skip-location-hook/";

  process.env.GOOD_API_KEY = (await APIKey.generate()).key;

  process.env.TWITTER_API_KEY = "test-twitter-api-key";
  process.env.TWITTER_API_SECRET = "test-twitter-api-secret";
  process.env.TWITTER_ACCESS_TOKEN = "test-twitter-access-token";
  process.env.TWITTER_ACCESS_SECRET = "test-twitter-access-secret";
  process.env.STATIC_SITE = "https://polls.pizza";
  process.env.UPLOAD_S3_BUCKET = "reports.polls.pizza";
});
afterEach(async () => {
  await dbHelper.cleanAll();
  (global.fetch as jest.Mock).mockClear();
});
