import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { config } from "../config";

export function twilioValidate(req: Request, res: Response, next: NextFunction): void {
  if (config.NODE_ENV === "development") {
    next();
    return;
  }

  const signature = req.headers["x-twilio-signature"] as string;
  const url = `${config.TWILIO_WEBHOOK_BASE}${req.originalUrl}`;
  const params = req.body as Record<string, string>;

  const valid = twilio.validateRequest(
    config.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!valid) {
    res.status(403).send("Forbidden");
    return;
  }

  next();
}
