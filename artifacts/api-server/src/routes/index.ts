import { Router, type IRouter } from "express";
import healthRouter from "./health";
import restaurantImportRouter from "./restaurant-import";
import outreachRouter from "./outreach";
import repliesRouter from "./replies";
import gmailRouter from "./gmail";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(restaurantImportRouter);
router.use(outreachRouter);
router.use(repliesRouter);
router.use(gmailRouter);
router.use(subscriptionsRouter);

export default router;
