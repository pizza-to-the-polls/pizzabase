import { handler } from "./refresh-threads-token";
import { AppDataSource } from "./data-source";
import { IntegrationSession } from "./entity/IntegrationSession";
import { notifyBugsnag } from "./lib/notifyBugsnag";

jest.mock("./lib/notifyBugsnag", () => ({
  notifyBugsnag: jest.fn(),
}));

async function seedToken(token: string) {
  const repo = AppDataSource.getRepository(IntegrationSession);
  const row = new IntegrationSession();
  row.service = "threads";
  row.credentials = { accessToken: token };
  await repo.save(row);
}

describe("refresh-threads-token handler", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    (notifyBugsnag as jest.Mock).mockClear();
  });

  it("refreshes the token and persists the new value", async () => {
    await seedToken("current-token");

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "refreshed-token" }),
    });

    const result = await handler();

    expect(result).toEqual({ success: true, refreshed: true });

    const repo = AppDataSource.getRepository(IntegrationSession);
    const row = await repo.findOne({ where: { service: "threads" } });
    expect(row?.credentials).toEqual({ accessToken: "refreshed-token" });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("refresh_access_token");
    expect(url).toContain("grant_type=th_refresh_token");
    expect(url).toContain(encodeURIComponent("current-token"));
  });

  it("throws and notifies Bugsnag when the refresh fails", async () => {
    await seedToken("current-token");

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("refresh error"),
    });

    await expect(handler()).rejects.toThrow("Threads token refresh failed");
    expect(notifyBugsnag).toHaveBeenCalled();
  });

  it("throws when no token is configured", async () => {
    await expect(handler()).rejects.toThrow("No Threads access token found");
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled();
  });
});
