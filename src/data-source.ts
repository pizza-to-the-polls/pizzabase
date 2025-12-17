import "reflect-metadata";
import { DataSource } from "typeorm";

import { Action } from "./entity/Action";
import { Donation } from "./entity/Donation";
import { Location } from "./entity/Location";
import { Order } from "./entity/Order";
import { Report } from "./entity/Report";
import { Truck } from "./entity/Truck";
import { Upload } from "./entity/Upload";


export let AppDataSource: DataSource;

export const initializeDataSource = (source?: DataSource): DataSource => {
  if (source) {
    AppDataSource = source;
  }

  if (AppDataSource) return AppDataSource;

  AppDataSource = new DataSource({
    type: "postgres",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    username: process.env.POSTGRES_USERNAME || "postgres",
    database: process.env.POSTGRES_DB || "pizzabase",
    password: process.env.POSTGRES_PASSWORD,

    synchronize: false,
    logging: false,
    entities: [
      Action,
      Donation,
      Location,
      Order,
      Report,
      Truck,
      Upload,
    ],
    migrationsRun: process.env.NODE_ENV === "prod",
    migrations: ["src/migration/**/*.ts"],
  });

  return AppDataSource;
};
