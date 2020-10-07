import dbHelper from "./dbHelper";

beforeAll(async () => {
  await dbHelper.setUpDB();
});
afterAll(async () => {
  await dbHelper.closeDB();
});
