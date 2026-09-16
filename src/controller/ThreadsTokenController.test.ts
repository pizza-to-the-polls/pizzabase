import * as http_mocks from "node-mocks-http";

import { ThreadsTokenController } from "./ThreadsTokenController";
import { AppDataSource } from "../data-source";
import { IntegrationSession } from "../entity/IntegrationSession";

const controller = new ThreadsTokenController();

describe("#update", () => {
  it("rejects requests without an API key", async () => {
    const response = http_mocks.createResponse();
    await controller.update(
      http_mocks.createRequest({
        method: "POST",
        body: { accessToken: "new-token" },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(401);
  });

  it("returns 422 when accessToken is missing", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.update(
      http_mocks.createRequest({
        method: "POST",
        body: {},
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(422);
    expect(body).toEqual({
      errors: { accessToken: "accessToken is required" },
    });
  });

  it("stores a new token for threads", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.update(
      http_mocks.createRequest({
        method: "POST",
        body: { accessToken: "new-long-lived-token" },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(200);
    expect(body).toEqual({ success: true });

    const repo = AppDataSource.getRepository(IntegrationSession);
    const row = await repo.findOne({ where: { service: "threads" } });
    expect(row?.credentials).toEqual({ accessToken: "new-long-lived-token" });
  });

  it("overwrites an existing token", async () => {
    const repo = AppDataSource.getRepository(IntegrationSession);
    const existing = new IntegrationSession();
    existing.service = "threads";
    existing.credentials = { accessToken: "old-token" };
    await repo.save(existing);

    const response = http_mocks.createResponse();
    const body = await controller.update(
      http_mocks.createRequest({
        method: "POST",
        body: { accessToken: "brand-new-token" },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(body).toEqual({ success: true });

    const row = await repo.findOne({ where: { service: "threads" } });
    expect(row?.credentials).toEqual({ accessToken: "brand-new-token" });
  });
});
