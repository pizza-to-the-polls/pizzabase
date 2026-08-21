import "reflect-metadata";
import { AppDataSource, initializeDataSource } from "./data-source";
import { IntegrationSession } from "./entity/IntegrationSession";
import { notifyBugsnag } from "./lib/notifyBugsnag";

let dataSourcePromise: Promise<unknown> | null = null;

function getDataSource(): Promise<unknown> {
  if (!dataSourcePromise) {
    dataSourcePromise = initializeDataSource();
  }
  return dataSourcePromise;
}

async function getToken(): Promise<string | null> {
  const repo = AppDataSource.getRepository(IntegrationSession);
  const row = await repo.findOne({ where: { service: "threads" } });
  return row?.credentials?.accessToken ?? null;
}

async function putToken(token: string): Promise<void> {
  const repo = AppDataSource.getRepository(IntegrationSession);
  let row = await repo.findOne({ where: { service: "threads" } });
  if (!row) {
    row = new IntegrationSession();
    row.service = "threads";
  }
  row.credentials = { accessToken: token };
  await repo.save(row);
}

export async function handler(): Promise<{
  success: boolean;
  refreshed: boolean;
}> {
  await getDataSource();

  const current = await getToken();
  if (!current) {
    throw new Error(
      "No Threads access token found in DB — cannot refresh. " +
        "Seed a token first via POST /threads-token.",
    );
  }

  const res = await fetch(
    "https://graph.threads.net/v1.0/refresh_access_token?" +
      "grant_type=th_refresh_token&access_token=" +
      encodeURIComponent(current),
  );

  if (!res.ok) {
    const err = new Error(
      `Threads token refresh failed: ${res.status} ${await res.text()}`,
    );
    notifyBugsnag(err);
    throw err;
  }

  const { access_token } = (await res.json()) as { access_token: string };
  await putToken(access_token);

  return { success: true, refreshed: true };
}
