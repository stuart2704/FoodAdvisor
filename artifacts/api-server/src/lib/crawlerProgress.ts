import { pool } from "@workspace/db";

export type CrawlerProgressPosition = {
  regionIndex: number;
  cityIndex: number;
  pointIndex: number;
};

export type CrawlerProgressRow = {
  id: number;
  last_region_index: number;
  last_city_index: number;
  last_point_index: number;
  last_run: Date;
  paid_requests: number;
};

function validatePosition(position: CrawlerProgressPosition): void {
  for (const [name, value] of Object.entries(position)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a nonnegative safe integer.`);
    }
  }
}

const selectProgress = `
  SELECT id, last_region_index, last_city_index, last_point_index, last_run, paid_requests
  FROM crawler_progress WHERE id = 1`;

export async function getCrawlerProgress(): Promise<CrawlerProgressRow> {
  const { rows } = await pool.query<CrawlerProgressRow>(selectProgress);
  if (rows.length !== 1) throw new Error("Crawler progress row 1 is missing; do not reset a live crawl.");
  return rows[0];
}

/**
 * Metadata update only. The expected position detects conflicting updates,
 * but this is not a paid-request reservation and must not replace the
 * manual crawler's validated progress file or pre-request budget checks.
 */
export async function updateCrawlerProgress(
  position: CrawlerProgressPosition,
  expected: CrawlerProgressPosition,
): Promise<CrawlerProgressRow> {
  validatePosition(position);
  validatePosition(expected);
  const { rows } = await pool.query<CrawlerProgressRow>(`
    UPDATE crawler_progress
    SET last_region_index = $1,
        last_city_index = $2,
        last_point_index = $3,
        last_run = NOW()
    WHERE id = 1
      AND last_region_index = $4
      AND last_city_index = $5
      AND last_point_index = $6
    RETURNING id, last_region_index, last_city_index, last_point_index, last_run, paid_requests
  `, [
    position.regionIndex, position.cityIndex, position.pointIndex,
    expected.regionIndex, expected.cityIndex, expected.pointIndex,
  ]);
  if (rows.length !== 1) throw new Error("Crawler progress changed concurrently or row 1 is missing.");
  return rows[0];
}