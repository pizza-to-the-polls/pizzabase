import { LocationsController } from "./controller/LocationsController";
import { ReportsController } from "./controller/ReportsController";
import { TrucksController } from "./controller/TrucksController";
import { RootController } from "./controller/RootController";
import { TotalsController } from "./controller/TotalsController";
import { OrdersController } from "./controller/OrdersController";
import { UploadsController } from "./controller/UploadsController";

export const Routes = [
  {
    method: "get",
    route: "/totals",
    controller: TotalsController,
    action: "overall",
  },
  {
    method: "get",
    route: "/totals/:year",
    controller: TotalsController,
    action: "yearly",
  },
  {
    method: "get",
    route: "/locations",
    controller: LocationsController,
    action: "all",
  },
  {
    method: "get",
    route: "/locations/:idOrAddress",
    controller: LocationsController,
    action: "one",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/validate",
    controller: LocationsController,
    action: "validate",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/skip",
    controller: LocationsController,
    action: "skip",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/truck",
    controller: LocationsController,
    action: "truck",
  },
  {
    method: "put",
    route: "/locations/:idOrAddress/order",
    controller: LocationsController,
    action: "order",
  },
  {
    method: "post",
    route: "/report",
    controller: ReportsController,
    action: "create",
  },
  {
    method: "post",
    route: "/truck",
    controller: TrucksController,
    action: "create",
  },
  {
    method: "post",
    route: "/trucks",
    controller: TrucksController,
    action: "all",
  },
  {
    method: "post",
    route: "/order",
    controller: OrdersController,
    action: "create",
  },
  {
    method: "get",
    route: "/orders",
    controller: OrdersController,
    action: "recent",
  },
  {
    method: "post",
    route: "/upload",
    controller: UploadsController,
    action: "create",
  },
  {
    method: "get",
    route: "/",
    controller: RootController,
    action: "root",
  },
];
