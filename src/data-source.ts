import * as path from "path";
import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import { AuroraPostgresConnectionOptions } from "typeorm/driver/aurora-postgres/AuroraPostgresConnectionOptions";
import { withDatabaseResumeRetry } from "./lib/retryDatabaseResume";
import { APIKey } from "./entity/APIKey";
import { Action } from "./entity/Action";
import { Donation } from "./entity/Donation";
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
  entities: ["src/entity/**/*.ts"],
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

// ── Aurora Serverless resume retry patch ──────────────────────────
// When the Aurora DB auto-pauses, queries during the resume window throw
// "resuming after being auto-paused". Wrap every query runner's query()
// method with retry+backoff so the request survives the resume window.
//
// This patch is only installed for the aurora-postgres driver.
// Dev and test use the plain postgres driver where resume errors never occur.

if (options.type === "aurora-postgres") {
  const originalCreateQueryRunner = AppDataSource.driver.createQueryRunner.bind(
    AppDataSource.driver
  );

  // Cast through any — monkey-patching the driver instance doesn't match
  // TypeORM's narrow Driver interface, but the runtime prototype is correct.
  (AppDataSource.driver as any).createQueryRunner = (mode?: any) => {
    const queryRunner = originalCreateQueryRunner(mode);
    const originalQuery = queryRunner.query.bind(queryRunner);

    queryRunner.query = ((
      query: string,
      parameters?: any[],
      useStructuredResult?: boolean
    ) => {
      return withDatabaseResumeRetry(() =>
        originalQuery(query, parameters, useStructuredResult)
      );
    }) as any;

    return queryRunner;
  };
}

export const initializeDataSource = async () => {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
};
