import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import {
  getOperationalEventsByIds,
  listOperationalEvents,
  setOperationalEventBookmark,
  setOperationalEventTags,
  type SanitizedOperationalEvent,
} from "../services/operationalLog";

const router: IRouter = Router();
const idSchema = z.string().uuid();
const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

router.get("/", adminOnly, async (req, res) => {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      type: z.string().trim().min(1).max(32).optional(),
      tag: tagSchema.optional(),
      bookmarked: z.enum(["true", "false"]).optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid log filters." });
    return;
  }
  try {
    const result = await listOperationalEvents({
      ...parsed.data,
      bookmarked:
        parsed.data.bookmarked === undefined
          ? undefined
          : parsed.data.bookmarked === "true",
    });
    res.json({ success: true, page: parsed.data.page, ...result });
  } catch {
    res.status(503).json({ success: false, error: "Logs are unavailable." });
  }
});

router.post("/bookmark", adminOnly, async (req, res) => {
  const parsed = z
    .object({ id: idSchema, bookmarked: z.boolean() })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid bookmark update." });
    return;
  }
  const updated = await setOperationalEventBookmark(
    parsed.data.id,
    parsed.data.bookmarked,
  );
  res.status(updated ? 200 : 404).json(
    updated
      ? { success: true }
      : { success: false, error: "Log event not found." },
  );
});

router.post("/tag", adminOnly, async (req, res) => {
  const parsed = z
    .object({
      id: idSchema,
      tags: z.array(tagSchema).max(10).transform((tags) => [...new Set(tags)]),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid tag update." });
    return;
  }
  const updated = await setOperationalEventTags(
    parsed.data.id,
    parsed.data.tags,
  );
  res.status(updated ? 200 : 404).json(
    updated
      ? { success: true }
      : { success: false, error: "Log event not found." },
  );
});

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(logs: SanitizedOperationalEvent[]): string {
  const header = [
    "id",
    "time",
    "type",
    "message",
    "category",
    "bookmarked",
    "tags",
  ];
  const rows = logs.map((log) =>
    [
      log.id,
      log.time,
      log.type,
      log.message,
      log.category ?? "",
      String(log.bookmarked),
      log.tags.join("|"),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...rows].join("\n");
}

router.post("/export", adminOnly, async (req, res) => {
  const parsed = z
    .object({
      ids: z.array(idSchema).min(1).max(200).transform((ids) => [...new Set(ids)]),
      format: z.enum(["json", "csv"]),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid export request." });
    return;
  }
  try {
    const logs = await getOperationalEventsByIds(parsed.data.ids);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="operational-logs.${parsed.data.format}"`,
    );
    if (parsed.data.format === "json") {
      res.type("application/json").send(JSON.stringify(logs, null, 2));
      return;
    }
    res.type("text/csv").send(toCsv(logs));
  } catch {
    res.status(503).json({ success: false, error: "Export is unavailable." });
  }
});

export default router;