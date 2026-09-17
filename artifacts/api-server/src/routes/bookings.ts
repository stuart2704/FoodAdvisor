import { getAuth } from "@clerk/express";
import {
  db,
  restaurantBookingsTable,
  restaurantsTable,
  userRewardEventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const BookingBody = z.object({
  restaurantId: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  guests: z.coerce.number().int().min(1).max(20),
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/bookings", bookingLimiter, async (req, res) => {
  const parsed = BookingBody.safeParse(req.body);
  if (!parsed.success || parsed.data.date < new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ success: false, error: "Booking details are invalid." });
    return;
  }
  try {
    const userId = getAuth(req).userId;
    const [restaurant] = await db
      .select({ id: restaurantsTable.placeId })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, parsed.data.restaurantId))
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    const booking = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(restaurantBookingsTable)
        .values({
          restaurantId: parsed.data.restaurantId,
          clerkUserId: userId ?? null,
          guestName: parsed.data.name,
          guestEmail: parsed.data.email.toLowerCase(),
          bookingDate: parsed.data.date,
          bookingTime: parsed.data.time,
          guests: parsed.data.guests,
        })
        .returning({ id: restaurantBookingsTable.id });
      if (userId) {
        await tx.insert(userRewardEventsTable).values({
          clerkUserId: userId,
          action: "booking",
          sourceId: String(created.id),
          points: 5,
        });
      }
      return created;
    });
    res.status(201).json({
      success: true,
      data: { id: booking.id, status: "requested" },
      message: "Booking request received.",
      pointsEarned: userId ? 5 : 0,
    });
  } catch (error) {
    req.log.error({ err: error }, "Booking request failed");
    res.status(503).json({ success: false, error: "Booking request could not be saved." });
  }
});

export default router;