import { Router, Request, Response } from "express";
import { twilioValidate } from "../middleware/twilioValidate";
import { completeSession } from "../services/supabase/sessions";

export const statusRouter = Router();

statusRouter.post("/", twilioValidate, async (req: Request, res: Response): Promise<void> => {
  const { CallSid, CallStatus } = req.body as { CallSid: string; CallStatus: string };

  if (CallStatus === "completed" || CallStatus === "failed" || CallStatus === "busy" || CallStatus === "no-answer") {
    try {
      await completeSession(CallSid, []);
    } catch (err) {
      console.error("Error finalizing session:", err);
    }
  }

  res.status(204).send();
});
