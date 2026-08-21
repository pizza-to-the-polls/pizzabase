import * as path from "path";
import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import { AuroraPostgresConnectionOptions } from "typeorm/driver/aurora-postgres/AuroraPostgresConnectionOptions";
import { withDatabaseResumeRetry } from "./lib/retryDatabaseResume";
import { APIKey } from "./entity/APIKey";
import { Action } from "./entity/Action";
import { Donation } from "./entity/Donation";
import { IntegrationSession } from "./entity/IntegrationSession";
import { Location } from "./entity/Location";
import { Order } from "./entity/Order";
import { Report } from "./entity/Report";
import { Truck } from "./entity/Truck";
import { Upload } from "./entity/Upload";
import { BannedPhoneNumber } from "./entity/BannedPhoneNumber";

const entities = [
  Action,
  APIKey,
  BannedPhoneNumber,
  Donation,
  IntegrationSession,
  Location,
  Order,
  Report,
  Truck,
  Upload,
];
const migrations = [path.join(__dirname, "migration", "*.{ts,js}")];
const subscribers = [path.join(__dirname, "subscriber", "*.{ts,js}")];

const prodConfig: AuroraPostgresConnectionOptions = {
  type: "aurora-postgres",
  database: process.env.DB_NAME,
  resourceArn: process.env.AURORA_RESOURCE_ARN,
  secretArn: process.env.AURORA_SECRET_ARN,
  region: process.env.AWS_REGION,
  formatOptions: {
    castParameters: true, // Recommended for Aurora Data API
  },
  synchronize: false,
  migrationsRun: false,
  entities,
  migrations,
  subscribers,
};

const devConfig: PostgresConnectionOptions = {
  type: "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  username: process.env.POSTGRES_USERNAME || "postgres",
  database: process.env.POSTGRES_DB || "pizzabase",
  password: process.env.POSTGRES_PASSWORD,
  synchronize: false,
  migrationsRun: false,
  entities,
  migrations,
  subscribers,
};

const testConfig: PostgresConnectionOptions = {
  type: "postgres",
  port: 5432,
  username: process.env.POSTGRES_USERNAME || "postgres",
  database: `${process.env.POSTGRES_DB || "pizzabaseTest"}`,
  password: process.env.POSTGRES_PASSWORD,
  dropSchema: true,
  synchronize: true,
  logging: false,
  entities,
  migrations: ["src/migration/**/*.ts"],
  subscribers: ["src/subscriber/**/*.ts"],
};

let options: DataSourceOptions;
if (process.env.NODE_ENV === "production") {
  options = prodConfig;
} else if (process.env.NODE_ENV === "test") {
  options = testConfig;
} else {
  options = devConfig;
}

export const AppDataSource = new DataSource(options);

// ── Aurora Data API parameter sanitization ────────────────────────
// The typeorm-aurora-data-api-driver's getType() has no mapping for
// JavaScript undefined, so it throws "'param_N' is an invalid type".
// The postgres driver (dev/test) silently converts undefined → NULL,
// but the Aurora RDS Data API is stricter.
//
// This helper walks top-level positional/named parameters and replaces
// every undefined with null so the driver maps them to type "NULL".

export const sanitizeQueryParameters = (
  parameters?: any[] | Record<string, unknown>,
): any[] | Record<string, unknown> | undefined => {
  if (parameters == null) return parameters;
  if (Array.isArray(parameters)) {
    return parameters.map((p) => (p === undefined ? null : p));
  }
  if (typeof parameters === "object") {
    return Object.fromEntries(
      Object.entries(parameters).map(([k, v]) => [
        k,
        v === undefined ? null : v,
      ]),
    );
  }
  return parameters;
};

// ── Aurora Serverless resume retry & parameter sanitizer patch ─────
// When the Aurora DB auto-pauses, queries during the resume window throw
// "resuming after being auto-paused". Wrap every query runner's query()
// method with retry+backoff so the request survives the resume window.
//
// Also sanitizes undefined→null in query parameters so the Aurora Data
// API driver doesn't throw "'param_N' is an invalid type".
//
// This patch is only installed for the aurora-postgres driver.
// Dev and test use the plain postgres driver where resume errors never occur
// and undefined params are already handled silently.

export const installAuroraCompatibilityPatches = (
  driver: any,
  sleep?: (ms: number) => Promise<void>,
): void => {
  const originalCreateQueryRunner = driver.createQueryRunner.bind(driver);

  // Cast through any — monkey-patching the driver instance doesn't match
  // TypeORM's narrow Driver interface, but the runtime prototype is correct.
  driver.createQueryRunner = (mode?: any) => {
    const queryRunner = originalCreateQueryRunner(mode);
    const originalQuery = queryRunner.query.bind(queryRunner);

    queryRunner.query = ((
      query: string,
      parameters?: any[],
      useStructuredResult?: boolean,
    ) => {
      const sanitized = sanitizeQueryParameters(parameters);
      return withDatabaseResumeRetry(
        () => originalQuery(query, sanitized, useStructuredResult),
        sleep ? { sleep } : undefined,
      );
    }) as any;

    return queryRunner;
  };
};

if (options.type === "aurora-postgres") {
  installAuroraCompatibilityPatches(AppDataSource.driver);
}

export const initializeDataSource = async () => {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
};
