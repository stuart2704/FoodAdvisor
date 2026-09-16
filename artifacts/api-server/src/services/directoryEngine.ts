import { db, restaurantsTable, type RestaurantRecord } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface DirectoryRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  tags: string[];
  rating: number | null;
  priceLevel: string | null;
  premium: boolean;
  rankingScore: number;
}

export interface DirectoryPage {
  page: number;
  total: number;
  totalPages: number;
  items: DirectoryRestaurant[];
}

function toDirectoryRestaurant(
  row: RestaurantRecord,
): DirectoryRestaurant {
  const cuisine = row.cuisineTags[0] ?? null;
  return {
    id: row.placeId,
    name: row.name,
    city: row.city,
    country: "United Kingdom",
    cuisine,
    tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
    rating: row.rating,
    priceLevel: row.priceLevel,
    premium: row.premium,
    rankingScore: calculateRanking({
      premium: row.premium,
      score: row.qualificationScore,
      popularity: row.popularity,
      aiRelevanceBoost: row.aiRelevanceBoost,
      city: row.city,
      country: "United Kingdom",
      cuisine,
    }),
  };
}

export async function getDirectoryPage(options: {
  city?: string;
  cuisine?: string;
  price?: string;
  premiumOnly?: boolean;
  page?: number;
} = {}): Promise<DirectoryPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = 20;
  const city = options.city?.trim();
  const cuisine = options.cuisine?.trim();
  const price = options.price?.trim();
  const conditions = [];
  if (city) {
    conditions.push(
      sql`lower(${restaurantsTable.city}) = lower(${city})`,
    );
  }
  if (cuisine) {
    conditions.push(sql`exists (
      select 1 from unnest(
        ${restaurantsTable.cuisineTags} || ${restaurantsTable.types}
      ) as directory_tag
      where lower(directory_tag) in (
        lower(${cuisine}),
        lower(${`${cuisine}_restaurant`})
      )
    )`);
  }
  if (options.premiumOnly) {
    conditions.push(eq(restaurantsTable.premium, true));
  }
  if (price) {
    conditions.push(
      sql`lower(${restaurantsTable.priceLevel}) = lower(${price})`,
    );
  }

  const rows = await db
    .select()
    .from(restaurantsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(restaurantsTable.rankingScore),
      desc(restaurantsTable.rating),
      restaurantsTable.name,
    )
    .limit(2_000);
  const ranked = rows
    .map(toDirectoryRestaurant)
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        left.name.localeCompare(right.name, "en-GB"),
    );
  const offset = (page - 1) * pageSize;

  return {
    page,
    total: ranked.length,
    totalPages: Math.ceil(ranked.length / pageSize),
    items: ranked.slice(offset, offset + pageSize),
  };
}

export default { getDirectoryPage };