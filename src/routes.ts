import { LocationController } from "./controller/LocationController";
import { ReportController } from "./controller/ReportController";
import { RootController } from "./controller/RootController";

export const PREFIX = `/api`;

export const Routes = [
  {
    method: "get",
    route: "/locations",
    controller: LocationController,
    action: "all",
  },
  {
    method: "get",
    route: "/locations/:id",
    controller: LocationController,
    action: "one",
  },
  {
    method: "put",
    route: "/locations/:id/validate",
    controller: LocationController,
    action: "validate",
  },
  {
    method: "put",
    route: "/locations/:id/order",
    controller: LocationController,
    action: "order",
  },
  {
    method: "post",
    route: "/report",
    controller: ReportController,
    action: "create",
  },
  {
    method: "get",
    route: "/",
    controller: RootController,
    action: "root",
  },
  {
    method: "get",
    route: "/",
    controller: RootController,
    action: "root",
    noPrefix: true,
  },
];
