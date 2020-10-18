import { LocationsController } from "./controller/LocationsController";
import { ReportController } from "./controller/ReportController";
import { RootController } from "./controller/RootController";
import { TotalsController } from "./controller/TotalsController";
import { OrdersController } from "./controller/OrdersController";

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
    route: "/locations/:idOrAddress/order",
    controller: LocationsController,
    action: "order",
  },
  {
    method: "post",
    route: "/report",
    controller: ReportController,
    action: "create",
  },
  {
    method: "post",
    route: "/order",
    controller: OrderController,
    action: "create",
  },
  {
    method: "get",
    route: "/",
    controller: RootController,
    action: "root",
  },
];
