import { Router } from "express";
const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

export default router;
