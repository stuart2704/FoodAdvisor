import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { createWorker } from "tesseract.js";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";

const router: IRouter = Router();

const PortalToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);

const scanLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
    fields: 0,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGES.has(file.mimetype)) {
      callback(new Error("Only JPEG, PNG, and WebP menu images are supported."));
      return;
    }
    callback(null, true);
  },
});

router.post(
  ["/menu-scan", "/menu-ocr"],
  scanLimiter,
  async (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsedToken = PortalToken.safeParse(req.header("X-Portal-Token"));
    if (!parsedToken.success) {
      res.status(401).json({ success: false, error: "Owner access required." });
      return;
    }
    const placeId = await validateToken(parsedToken.data);
    if (!placeId) {
      res.status(401).json({ success: false, error: "Owner access required." });
      return;
    }
    res.locals.placeId = placeId;
    next();
  },
  (req, res, next) => {
    upload.single("menu")(req, res, (error) => {
      if (error) {
        res.status(400).json({
          success: false,
          error:
            error instanceof multer.MulterError &&
            error.code === "LIMIT_FILE_SIZE"
              ? "Menu images must be 8 MB or smaller."
              : error instanceof Error
                ? error.message
                : "Invalid menu image.",
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const placeId = res.locals.placeId as string;
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: "Attach a menu image in the menu field.",
      });
      return;
    }

    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(req.file.buffer);
      res.json({
        success: true,
        restaurantId: placeId,
        text: result.data.text.trim().slice(0, 100_000),
        confidence: Number(result.data.confidence.toFixed(1)),
      });
    } catch (error) {
      req.log.error({ err: error, placeId }, "Menu OCR failed");
      res.status(503).json({
        success: false,
        error: "The menu image could not be read.",
      });
    } finally {
      await worker.terminate();
    }
  },
);

export default router;