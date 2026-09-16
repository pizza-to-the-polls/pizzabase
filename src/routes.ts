import { LocationsController } from "./controller/LocationsController";
import { ReportsController } from "./controller/ReportsController";
import { TrucksController } from "./controller/TrucksController";
import { RootController } from "./controller/RootController";
import { TotalsController } from "./controller/TotalsController";
import { OrdersController } from "./controller/OrdersController";
import { UploadsController } from "./controller/UploadsController";
import { SightEngineController } from "./controller/SightEngineController";
import { SessionController } from "./controller/SessionController";
import { DonationsController } from "./controller/DonationsController";
import { ThreadsTokenController } from "./controller/ThreadsTokenController";
import { BannedPhoneNumbersController } from "./controller/BannedPhoneNumbersController";

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
    action: "index",
  },
  {
    method: "get",
    route: "/locations/:idOrAddress",
    controller: LocationsController,
    action: "show",
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
    method: "delete",
    route: "/locations/:idOrAddress",
    controller: LocationsController,
    action: "merge",
  },
  {
    method: "post",
    route: "/report",
    controller: ReportsController,
    action: "create",
  },
  {
    method: "get",
    route: "/reports/",
    controller: ReportsController,
    action: "index",
  },
  {
    method: "get",
    route: "/reports/:id",
    controller: ReportsController,
    action: "show",
  },
  {
    method: "post",
    route: "/truck",
    controller: TrucksController,
    action: "create",
  },
  {
    method: "get",
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
    action: "index",
  },
  {
    method: "get",
    route: "/orders/:id",
    controller: OrdersController,
    action: "show",
  },
  {
    method: "delete",
    route: "/orders/:id",
    controller: OrdersController,
    action: "delete",
  },
  {
    method: "post",
    route: "/upload",
    controller: UploadsController,
    action: "create",
  },
  {
    method: "get",
    route: "/uploads/:fileName/exif",
    controller: UploadsController,
    action: "getExif",
  },
  {
    method: "get",
    route: "/uploads/:fileName/sightengine",
    controller: SightEngineController,
    action: "getSightEngineScore",
  },
  {
    method: "post",
    route: "/session",
    controller: SessionController,
    action: "create",
  },
  {
    method: "put",
    route: "/session",
    controller: SessionController,
    action: "update",
  },
  {
    method: "post",
    route: "/donations",
    controller: DonationsController,
    action: "create",
  },
  {
    method: "post",
    route: "/webhook",
    controller: DonationsController,
    action: "webhook",
  },
  {
    method: "post",
    route: "/threads-token",
    controller: ThreadsTokenController,
    action: "update",
  },
  {
    method: "get",
    route: "/banned-phone-numbers",
    controller: BannedPhoneNumbersController,
    action: "index",
  },
  {
    method: "get",
    route: "/banned-phone-numbers/:idOrPhoneNumber",
    controller: BannedPhoneNumbersController,
    action: "show",
  },
  {
    method: "post",
    route: "/banned-phone-numbers",
    controller: BannedPhoneNumbersController,
    action: "create",
  },
  {
    method: "delete",
    route: "/banned-phone-numbers/:id",
    controller: BannedPhoneNumbersController,
    action: "delete",
  },
  {
    method: "get",
    route: "/health",
    controller: RootController,
    action: "health",
  },
  {
    method: "get",
    route: "/",
    controller: RootController,
    action: "root",
  },
];
