import { LocationController } from "./controller/LocationController";
import { ReportController } from "./controller/ReportController";

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
    route: "/locations/:IdOrFullAddress",
    controller: LocationController,
    action: "update",
  },
  {
    method: "put",
    route: "/report",
    controller: ReportController,
    action: "create",
  },
];
