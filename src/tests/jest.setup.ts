import dbHelper from "./dbHelper";

beforeAll(async () => {
  await dbHelper.setUpDB();
});
afterEach(async () => {
  await dbHelper.cleanAll();
});
afterAll(async () => {
  await dbHelper.closeDB();
});
