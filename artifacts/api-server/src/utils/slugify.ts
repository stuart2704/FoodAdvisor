import { createHash } from "node:crypto";

export const slugify = (text: unknown): string =>
  String(text)
    .toLocaleLowerCase("en-GB")
    .trim()
    .replace(/[\s\W-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Build directory slugs from the complete set of names, regardless of DB row order. */
export function locationSlugs(names: readonly string[]): Map<string, string> {
  const unique = [...new Set(names)].sort();
  const bases = new Map(unique.map((name) => [name, slugify(name) || "location"]));
  const counts = new Map<string, number>();
  for (const base of bases.values()) counts.set(base, (counts.get(base) ?? 0) + 1);

  // Reserve every unsuffixed slug so a collision suffix cannot steal another name's URL.
  const used = new Set(bases.values());
  const result = new Map<string, string>();
  for (const name of unique) {
    const base = bases.get(name)!;
    if (counts.get(base) === 1) {
      result.set(name, base);
      continue;
    }
    const hash = createHash("sha256").update(name).digest("hex");
    // Leave room for the entire digest if a shorter suffix ever conflicts.
    const prefix = base.slice(0, 55).replace(/-+$/, "");
    let length = 12;
    let candidate = `${prefix}-${hash.slice(0, length)}`;
    while (used.has(candidate) && length < hash.length) {
      length += 2;
      candidate = `${prefix}-${hash.slice(0, length)}`;
    }
    // A full digest collision is extraordinarily unlikely, but still must not alias a URL.
    if (used.has(candidate)) {
      let counter = 2;
      while (used.has(`${candidate}-${counter}`)) counter++;
      candidate = `${candidate}-${counter}`;
    }
    used.add(candidate);
    result.set(name, candidate);
  }
  return result;
}

export function restaurantSlug(name: string, placeId: string): string {
  const suffix = createHash("sha256").update(placeId).digest("hex").slice(0, 10);
  return `${slugify(name) || "restaurant"}-${suffix}`;
}