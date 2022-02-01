import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";

export class RootController {
  async root(_request: Request, _response: Response, _next: NextFunction) {
    return { success: "🍕 🇺🇸 🦅 🗳 🎉 " };
  }
  async health(_request: Request, _response: Response, _next: NextFunction) {
    const [loc] = await Location.find({ take: 1, select: ["id"] });
    return { success: loc !== null };
  }
}
