import { getAuth } from "@clerk/express";
import { db, userRewardEventsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/rewards", async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "Sign in to view rewards." });
    return;
  }
  try {
    const [[total], activity] = await Promise.all([
      db
        .select({
          points: sql<number>`coalesce(sum(${userRewardEventsTable.points}), 0)`.mapWith(
            Number,
          ),
        })
        .from(userRewardEventsTable)
        .where(eq(userRewardEventsTable.clerkUserId, userId)),
      db
        .select({
          id: userRewardEventsTable.id,
          action: userRewardEventsTable.action,
          points: userRewardEventsTable.points,
          createdAt: userRewardEventsTable.createdAt,
        })
        .from(userRewardEventsTable)
        .where(eq(userRewardEventsTable.clerkUserId, userId))
        .orderBy(desc(userRewardEventsTable.createdAt))
        .limit(50),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      success: true,
      data: {
        points: total?.points ?? 0,
        activity,
        policy: { review: 10, booking: 5 },
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Reward balance query failed");
    res.status(503).json({
      success: false,
      error: "Rewards are temporarily unavailable.",
    });
  }
});

export default router;