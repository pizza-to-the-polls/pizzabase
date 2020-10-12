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
    route: "/locations/:idOrAddress",
    controller: LocationController,
    action: "one",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/validate",
    controller: LocationController,
    action: "validate",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/skip",
    controller: LocationController,
    action: "skip",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/order",
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
];
