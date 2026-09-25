import { db, locationSlugAliasesTable, restaurantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { locationSlugs } from "./slugify";

type LocationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type LocationKind = "city" | "region";

// Run inside the transaction that changes the restaurant. A moved restaurant
// must not redirect a city/region that still has other restaurants in it, but
// slug collisions can also change the URLs of locations that did not move.
export async function preserveVanishedLocation(
  tx: LocationTransaction,
  kind: LocationKind,
  former: string | null,
  current: string | null,
  namesBefore: string[],
): Promise<void> {
  if (!current || former === current) return;
  const column = kind === "city" ? restaurantsTable.city : restaurantsTable.region;
  const after = await tx.selectDistinct({ name: column }).from(restaurantsTable).limit(1_000);
  const namesAfter = after.flatMap(row => row.name ? [row.name] : []);
  const priorSlugs = locationSlugs(namesBefore);
  const newSlugs = locationSlugs(namesAfter);
  if (former && !newSlugs.has(former)) {
    await tx.update(locationSlugAliasesTable)
      .set({ targetName: current })
      .where(and(
        eq(locationSlugAliasesTable.kind, kind),
        eq(locationSlugAliasesTable.targetName, former),
      ));
  }
  for (const [name, oldSlug] of priorSlugs) {
    const destination = name === former && !newSlugs.has(name) ? current : name;
    if (newSlugs.get(destination) === oldSlug) continue;
    await tx.insert(locationSlugAliasesTable)
      .values({ kind, slug: oldSlug, targetName: destination })
      .onConflictDoUpdate({
        target: [locationSlugAliasesTable.kind, locationSlugAliasesTable.slug],
        set: { targetName: destination },
      });
  }
}

export async function aliasTarget(kind: "city" | "region", slug: string): Promise<string | undefined> {
  const [alias] = await db
    .select({ targetName: locationSlugAliasesTable.targetName })
    .from(locationSlugAliasesTable)
    .where(and(
      eq(locationSlugAliasesTable.kind, kind),
      eq(locationSlugAliasesTable.slug, slug),
    ))
    .limit(1);
  return alias?.targetName;
}

export function canonicalLocationPath(kind: "city" | "region", slug: string): string {
  return `/api/${kind === "city" ? "cities" : "regions"}/${slug}`;
}

export function canonicalLocationLink(path: string): string {
  return `<${path}>; rel="canonical"`;
}