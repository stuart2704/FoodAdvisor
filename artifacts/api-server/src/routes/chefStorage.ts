import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, restaurantChefProfilesTable } from "@workspace/db";
import { streamChefObject } from "../lib/chefObjectStorage";

const router: IRouter = Router();

router.get("/storage/objects/chef/:objectId", async (req, res): Promise<void> => {
  const objectId = Array.isArray(req.params.objectId) ? req.params.objectId[0] : req.params.objectId;
  if (!/^[0-9a-f-]{36}$/.test(objectId)) {
    res.status(404).json({ error: "Object not found." });
    return;
  }
  const objectPath = `/objects/chef/${objectId}`;
  const [profile] = await db
    .select({ photoObjectPath: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(
      and(
        eq(restaurantChefProfilesTable.photoObjectPath, objectPath),
        eq(restaurantChefProfilesTable.moderationStatus, "approved"),
      ),
    )
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "Object not found." });
    return;
  }
  await streamChefObject(objectPath, res);
});

export default router;