import { LocationsController } from "./controller/LocationsController";
import { ReportsController } from "./controller/ReportsController";
import { TrucksController } from "./controller/TrucksController";
import { RootController } from "./controller/RootController";
import { TotalsController } from "./controller/TotalsController";
import { OrdersController } from "./controller/OrdersController";
import { UploadsController } from "./controller/UploadsController";
import { SightEngineController } from "./controller/SightEngineController";
import { ClipsController } from "./controller/ClipsController";
import { SessionController } from "./controller/SessionController";
import { DonationsController } from "./controller/DonationsController";
import { ThreadsTokenController } from "./controller/ThreadsTokenController";
import { BannedPhoneNumbersController } from "./controller/BannedPhoneNumbersController";
import { BlockedIpsController } from "./controller/BlockedIpsController";
import { LinksController } from "./controller/LinksController";
import { TwilioInboundController } from "./controller/TwilioInboundController";
import { FeedObservationsController } from "./controller/FeedObservationsController";
import { WaitTimeSourcesController } from "./controller/WaitTimeSourcesController";
import { PartnerReportsController } from "./controller/PartnerReportsController";

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
    route: "/locations/:id/wait-time-sources",
    controller: WaitTimeSourcesController,
    action: "forLocation",
  },
  {
    method: "get",
    route: "/wait-time-sources",
    controller: WaitTimeSourcesController,
    action: "index",
  },
  {
    method: "post",
    route: "/wait-time-sources",
    controller: WaitTimeSourcesController,
    action: "create",
  },
  {
    method: "put",
    route: "/wait-time-sources/:id",
    controller: WaitTimeSourcesController,
    action: "update",
  },
  {
    method: "delete",
    route: "/wait-time-sources/:id",
    controller: WaitTimeSourcesController,
    action: "destroy",
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
    method: "post",
    route: "/partner/session",
    controller: PartnerReportsController,
    action: "session",
  },
  {
    method: "post",
    route: "/partner/report",
    controller: PartnerReportsController,
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
    route: "/reports/:idOrAddress/media",
    controller: ReportsController,
    action: "media",
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
    method: "post",
    route: "/uploads/media-format-callback",
    controller: UploadsController,
    action: "mediaFormatCallback",
  },
  {
    method: "get",
    route: "/uploads/:fileName",
    controller: UploadsController,
    action: "showMedia",
  },
  {
    method: "get",
    route: "/uploads/:fileName/poster",
    controller: UploadsController,
    action: "showPoster",
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
    route: "/twilio/inbound",
    controller: TwilioInboundController,
    action: "inbound",
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
  // ── IP blocklist (issue #352) ──────────────────────────────
  {
    method: "get",
    route: "/blocked-ips",
    controller: BlockedIpsController,
    action: "index",
  },
  {
    method: "get",
    route: "/blocked-ips/:idOrIpHash",
    controller: BlockedIpsController,
    action: "show",
  },
  {
    method: "post",
    route: "/blocked-ips",
    controller: BlockedIpsController,
    action: "create",
  },
  {
    method: "delete",
    route: "/blocked-ips/:id",
    controller: BlockedIpsController,
    action: "delete",
  },
  {
    method: "post",
    route: "/clips",
    controller: ClipsController,
    action: "create",
  },
  {
    method: "get",
    route: "/clips",
    controller: ClipsController,
    action: "index",
  },
  {
    method: "get",
    route: "/clips/:id",
    controller: ClipsController,
    action: "show",
  },
  {
    method: "post",
    route: "/clips/:id/approve",
    controller: ClipsController,
    action: "approve",
  },
  {
    method: "post",
    route: "/clips/:id/publish",
    controller: ClipsController,
    action: "publish",
  },
  {
    method: "post",
    route: "/clips/:id/reject",
    controller: ClipsController,
    action: "reject",
  },
  {
    method: "post",
    route: "/clips/:id/requeue",
    controller: ClipsController,
    action: "requeue",
  },
  // ── Feedflag observations (FEAT-002d) ───────────────────────
  {
    method: "post",
    route: "/feed-observations",
    controller: FeedObservationsController,
    action: "create",
  },
  {
    method: "get",
    route: "/feed-observations",
    controller: FeedObservationsController,
    action: "index",
  },
  {
    method: "get",
    route: "/feed-observations/summary",
    controller: FeedObservationsController,
    action: "summary",
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
  // ── Short Links ─────────────────────────────────────────────
  {
    method: "get",
    route: "/l/:slug",
    controller: LinksController,
    action: "redirect",
  },
  {
    method: "post",
    route: "/links",
    controller: LinksController,
    action: "create",
  },
  {
    method: "get",
    route: "/links/:slug/clicks",
    controller: LinksController,
    action: "clicks",
  },
];
