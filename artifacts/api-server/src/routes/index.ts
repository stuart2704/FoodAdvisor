import { Router, type IRouter } from "express";
import healthRouter from "./health";
import restaurantImportRouter from "./restaurant-import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(restaurantImportRouter);

export default router;
