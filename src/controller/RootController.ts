import { NextFunction, Request, Response } from "express";

export class RootController {
  async root(_request: Request, _response: Response, _next: NextFunction) {
    return { success: "🍕 🇺🇸 🦅 🗳 🎉 " };
  }
}
