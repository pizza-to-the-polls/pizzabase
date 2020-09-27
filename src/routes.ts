import { LocationController } from "./controller/LocationController";
import { ReportController } from "./controller/ReportController";
import { RootController } from "./controller/RootController";

export const Routes = [
  {
    method: "get",
    route: "/locations",
    controller: LocationController,
    action: "all",
  },
  {
    method: "get",
    route: "/locations/:IdOrFullAddress",
    controller: LocationController,
    action: "one",
  },
  {
    method: "put",
    route: "/locations/:IdOrFullAddress/validate",
    controller: LocationController,
    action: "validate",
  },
  {
    method: "put",
    route: "/locations/:IdOrFullAddress/order",
    controller: LocationController,
    action: "order",
  },
  {
    method: "put",
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
];
