import { Router, type IRouter } from "express";
import { createGmailWatchHandler } from "./gmail";

const router: IRouter = Router();

router.post("/activate-gmail-watch", createGmailWatchHandler(true));
router.post("/renew-gmail-watch", createGmailWatchHandler(true, true));

export default router;