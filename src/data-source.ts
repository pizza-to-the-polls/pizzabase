import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import { AuroraPostgresConnectionOptions } from "typeorm/driver/aurora-postgres/AuroraPostgresConnectionOptions";
import { Action } from "./entity/Action";
import { Donation } from "./entity/Donation";
import { Location } from "./entity/Location";
import { Order } from "./entity/Order";
import { Report } from "./entity/Report";
import { Truck } from "./entity/Truck";
import { Upload } from "./entity/Upload";

const entities = [Action, Donation, Location, Order, Report, Truck, Upload];
const migrations = ["src/migration/**/*.ts"];
const subscribers = ["src/subscriber/**/*.ts"];

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
if (process.env.NODE_ENV === "prod") {
  options = prodConfig;
} else if (process.env.NODE_ENV === "test") {
  options = testConfig;
} else {
  options = devConfig;
}

export const AppDataSource = new DataSource(options);

export const initializeDataSource = async () => {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
};
