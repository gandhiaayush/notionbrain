import { Router, Request, Response } from "express";
import twilio from "twilio";
import { config } from "../config";

export const outboundRouter = Router();

outboundRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const { phone, customerName, orderId, callType, reason, pageId } = req.body as {
    phone: string; customerName: string; orderId: string;
    callType?: string; reason?: string; pageId?: string;
  };

  if (!phone || !customerName || !orderId) {
    res.status(400).json({ error: "Missing phone, customerName, or orderId" });
    return;
  }

  try {
    const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
    const params = new URLSearchParams({ outbound: "true", customerName, orderId, callType: callType ?? "pickup" });
    if (reason) params.set("reason", reason);
    if (pageId) params.set("pageId", pageId);
    const voiceUrl = `${config.TWILIO_WEBHOOK_BASE}/voice?${params.toString()}`;

    await client.calls.create({
      to: phone,
      from: config.TWILIO_PHONE_NUMBER,
      url: voiceUrl,
    });

    res.sendStatus(204);
  } catch (err) {
    console.error("[outbound] Failed to initiate call:", err);
    res.status(500).json({ error: "Failed to initiate outbound call" });
  }
});
