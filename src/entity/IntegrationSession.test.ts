import { AppDataSource } from "../data-source";
import { IntegrationSession } from "./IntegrationSession";

describe("IntegrationSession", () => {
  it("exposes a single credentials blob with no fixed credential columns", () => {
    const metadata = AppDataSource.getMetadata(IntegrationSession);
    const columnNames = metadata.columns.map((column) => column.propertyName);

    expect(columnNames).toContain("service");
    expect(columnNames).toContain("credentials");
    expect(columnNames).toContain("updatedAt");

    // The BlueSky-specific credential columns must be gone so that new
    // integrations can store arbitrary shapes without a schema change.
    expect(columnNames).not.toContain("accessJwt");
    expect(columnNames).not.toContain("refreshJwt");
    expect(columnNames).not.toContain("did");
    expect(columnNames).not.toContain("handle");
  });

  it("round-trips a BlueSky credential shape through the blob", async () => {
    const repo = AppDataSource.getRepository(IntegrationSession);
    const row = new IntegrationSession();
    row.service = "bluesky";
    row.credentials = {
      accessJwt: "access-1",
      refreshJwt: "refresh-1",
      did: "did:plc:test",
      handle: "test.test",
    };
    await repo.save(row);

    const loaded = await repo.findOne({ where: { service: "bluesky" } });
    expect(loaded).toBeTruthy();
    expect(loaded!.credentials).toEqual({
      accessJwt: "access-1",
      refreshJwt: "refresh-1",
      did: "did:plc:test",
      handle: "test.test",
    });
  });

  it("stores an arbitrary credential shape for another service without schema changes", async () => {
    const repo = AppDataSource.getRepository(IntegrationSession);
    const row = new IntegrationSession();
    row.service = "threads";
    row.credentials = { accessToken: "threads-token" };
    await repo.save(row);

    const loaded = await repo.findOne({ where: { service: "threads" } });
    expect(loaded).toBeTruthy();
    expect(loaded!.credentials).toEqual({ accessToken: "threads-token" });
  });
});
