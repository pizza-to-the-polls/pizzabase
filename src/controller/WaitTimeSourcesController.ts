import { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Location } from "../entity/Location";
import {
  SourceType,
  WaitTimeScope,
  WaitTimeSource,
} from "../entity/WaitTimeSource";
import { checkAuthorization, findOr404 } from "./helper";

const SCOPES: WaitTimeScope[] = ["statewide", "county", "location"];
const SOURCE_TYPES: SourceType[] = ["link", "api", "iframe"];

export class WaitTimeSourcesController {
  // GET /wait-time-sources?state=PA&scope=county&active=true&limit=100&page=0
  async index(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = Number.isFinite(limit) && limit < 100 ? limit : 100;
    const page = Number.isFinite(Number(request.query.page))
      ? Number(request.query.page)
      : 0;
    const skip = Math.max(0, page) * take;

    const where: Record<string, unknown> = {};
    const { state, scope, active, is_active } = request.query;

    if (state) where.state = String(state);
    if (scope) where.scope = String(scope);
    if (active !== undefined || is_active !== undefined) {
      where.isActive = String(active ?? is_active) !== "false";
    }

    const [sources, count] = await WaitTimeSource.findAndCount({
      where,
      take,
      skip,
      order: { id: "ASC" },
    });

    return {
      results: sources.map((source) => source.asJSON()),
      count,
    };
  }

  // GET /locations/:id/wait-time-sources
  async forLocation(request: Request, response: Response, next: NextFunction) {
    const location: Location = await findOr404(
      await Location.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!location) return;

    const sources = await AppDataSource.getRepository(WaitTimeSource)
      .createQueryBuilder("source")
      .where("source.isActive = TRUE")
      .andWhere("source.state = :state", { state: location.state })
      .andWhere(
        `(
          source.scope = 'statewide'
          OR (source.scope = 'county' AND source.county = :county)
          OR (source.scope = 'location' AND source.locationId = :locationId)
        )`,
        { county: location.county, locationId: location.id },
      )
      .orderBy(
        "CASE source.scope WHEN 'location' THEN 0 WHEN 'county' THEN 1 ELSE 2 END",
        "ASC",
      )
      .addOrderBy("source.id", "ASC")
      .getMany();

    // Deduplicate by URL (first wins — highest-priority scope comes first)
    const seen = new Set<string>();
    const unique = sources.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });

    return {
      results: unique.map((source) => source.asJSON()),
      count: unique.length,
    };
  }

  // POST /wait-time-sources (auth-gated)
  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const body = request.body || {};
    const { errors, scope, state, county, locationId, sourceType, url } =
      this.validateScopeConstraints(body);

    if (errors.length > 0) {
      response.status(422);
      return { errors };
    }

    const source = new WaitTimeSource();
    source.scope = scope;
    source.state = state;
    source.county = county;
    source.locationId = locationId;
    source.url = url;
    source.sourceType = sourceType;
    source.displayLabel = body.display_label || body.displayLabel || null;
    source.notes = body.notes || null;
    source.discoveryMethod =
      body.discovery_method || body.discoveryMethod || null;
    source.discoveryConfidence =
      body.discovery_confidence ?? body.discoveryConfidence ?? null;

    if (body.is_active !== undefined) {
      source.isActive = body.is_active !== false;
    }
    if (body.last_verified_at) {
      source.lastVerifiedAt = new Date(body.last_verified_at);
    }

    try {
      await source.save();
    } catch (err) {
      response.status(422);
      return { errors: [(err as Error).message] };
    }

    return source.asJSON();
  }

  // PUT /wait-time-sources/:id (auth-gated)
  async update(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const source: WaitTimeSource = await findOr404(
      await WaitTimeSource.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!source) return;

    const body = request.body || {};

    if (body.url !== undefined) source.url = body.url;
    if (body.display_label !== undefined)
      source.displayLabel = body.display_label;
    if (body.displayLabel !== undefined)
      source.displayLabel = body.displayLabel;
    if (body.notes !== undefined) source.notes = body.notes;
    if (body.source_type !== undefined) {
      if (!SOURCE_TYPES.includes(body.source_type)) {
        response.status(422);
        return { errors: [`Invalid source_type: ${body.source_type}`] };
      }
      source.sourceType = body.source_type;
    }
    if (body.is_active !== undefined) {
      source.isActive = body.is_active !== false;
    }
    if (body.last_verified_at !== undefined) {
      source.lastVerifiedAt = body.last_verified_at
        ? new Date(body.last_verified_at)
        : null;
    }
    if (body.last_success_at !== undefined) {
      source.lastSuccessAt = body.last_success_at
        ? new Date(body.last_success_at)
        : null;
    }
    if (body.last_error_at !== undefined) {
      source.lastErrorAt = body.last_error_at
        ? new Date(body.last_error_at)
        : null;
    }
    if (body.last_error_message !== undefined) {
      source.lastErrorMessage = body.last_error_message;
    }

    // If any scope-constrained field is changing, re-validate the combination.
    const hasScopeChange =
      body.scope !== undefined ||
      body.state !== undefined ||
      body.county !== undefined ||
      body.location_id !== undefined ||
      body.locationId !== undefined;

    if (hasScopeChange) {
      const candidate = {
        scope: body.scope ?? source.scope,
        state: body.state ?? source.state,
        county: body.county !== undefined ? body.county : source.county,
        // url/source_type ride along from the existing source — the validator
        // requires url, but a scope transition must not 422 on the unchanged url
        url: source.url,
        source_type: source.sourceType,
        locationId:
          body.location_id !== undefined
            ? body.location_id
            : body.locationId !== undefined
              ? body.locationId
              : source.locationId,
      };
      const { errors } = this.validateScopeConstraints(candidate);
      if (errors.length > 0) {
        response.status(422);
        return { errors };
      }
      source.scope = candidate.scope as WaitTimeScope;
      source.state = candidate.state;
      source.county = candidate.county;
      source.locationId = candidate.locationId;
    }

    try {
      await source.save();
    } catch (err) {
      response.status(422);
      return { errors: [(err as Error).message] };
    }

    return source.asJSON();
  }

  // DELETE /wait-time-sources/:id (auth-gated, soft-delete)
  async destroy(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const source: WaitTimeSource = await findOr404(
      await WaitTimeSource.findOne({
        where: { id: Number(request.params.id || ""), isActive: true },
      }),
      response,
      next,
    );
    if (!source) return;

    source.isActive = false;
    await source.save();

    return { success: true };
  }

  // Validates scope constraints per the wait_time_sources CHECK constraint:
  // - statewide: county IS NULL AND location_id IS NULL
  // - county:    county IS NOT NULL AND location_id IS NULL
  // - location:  location_id IS NOT NULL
  private validateScopeConstraints(body: Record<string, any>): {
    errors: string[];
    scope: WaitTimeScope;
    state: string;
    county: string | null;
    locationId: number | null;
    sourceType: SourceType;
    url: string;
  } {
    const errors: string[] = [];

    const scope = body.scope as WaitTimeScope;
    const state: string = body.state;
    const county = body.county ?? null;
    const locationId =
      body.location_id !== undefined
        ? body.location_id
        : (body.locationId ?? null);
    const sourceType = body.source_type || "link";
    const url = body.url;

    if (!SCOPES.includes(scope)) {
      errors.push(`Invalid scope: ${scope}`);
    }
    if (!state || String(state).length !== 2) {
      errors.push("state is required and must be a 2-character code");
    }
    if (!url) {
      errors.push("url is required");
    }
    if (!SOURCE_TYPES.includes(sourceType)) {
      errors.push(`Invalid source_type: ${sourceType}`);
    }

    if (scope === "statewide") {
      if (county) {
        errors.push("county must not be set when scope is 'statewide'");
      }
      if (locationId) {
        errors.push("location_id must not be set when scope is 'statewide'");
      }
    } else if (scope === "county") {
      if (!county) {
        errors.push("county is required when scope is 'county'");
      }
      if (locationId) {
        errors.push("location_id must not be set when scope is 'county'");
      }
    } else if (scope === "location") {
      if (!locationId) {
        errors.push("location_id is required when scope is 'location'");
      }
    }

    return {
      errors,
      scope,
      state,
      county,
      locationId,
      sourceType,
      url,
    };
  }
}
