export type CuisineEvidence = {
  tag: string;
  matchedAlias: string;
  source: "website" | "google_type";
};

export type CuisineDetectionResult = {
  cuisines: string[];
  dietaryTags: string[];
  evidence: CuisineEvidence[];
  confidence: number;
};

const CUISINE_ALIASES: Record<string, string[]> = {
  american: ["american", "burger", "barbecue", "bbq"],
  british: ["british", "english", "gastropub"],
  caribbean: ["caribbean", "jamaican"],
  chinese: ["chinese", "cantonese", "sichuan", "szechuan"],
  ethiopian: ["ethiopian"],
  french: ["french", "bistro", "brasserie"],
  greek: ["greek"],
  indian: ["indian", "punjabi", "tandoori"],
  italian: ["italian", "pizzeria", "pizza", "trattoria"],
  japanese: ["japanese", "sushi", "ramen"],
  korean: ["korean"],
  lebanese: ["lebanese"],
  mediterranean: ["mediterranean"],
  mexican: ["mexican", "taco", "taqueria"],
  spanish: ["spanish", "tapas"],
  thai: ["thai"],
  turkish: ["turkish"],
  vietnamese: ["vietnamese", "pho"],
};

const DIETARY_ALIASES: Record<string, string[]> = {
  "gluten-free": ["gluten free", "gluten-free"],
  halal: ["halal"],
  kosher: ["kosher"],
  vegan: ["vegan"],
  vegetarian: ["vegetarian"],
};

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i");
}

export function detectCuisine(input: {
  websiteTitle?: string | null;
  websiteDescription?: string | null;
  googlePlaceTypes?: string[];
}): CuisineDetectionResult {
  const website = [input.websiteTitle, input.websiteDescription]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const googleTypes = input.googlePlaceTypes ?? [];
  const evidence: CuisineEvidence[] = [];
  const cuisines = new Set<string>();
  const dietaryTags = new Set<string>();

  for (const [tag, aliases] of Object.entries(CUISINE_ALIASES)) {
    for (const alias of aliases) {
      if (aliasPattern(alias).test(website)) {
        cuisines.add(tag);
        evidence.push({ tag, matchedAlias: alias, source: "website" });
        break;
      }
      const matchingType = googleTypes.find((type) =>
        aliasPattern(alias).test(type.replace(/_/g, " ")),
      );
      if (matchingType) {
        cuisines.add(tag);
        evidence.push({
          tag,
          matchedAlias: matchingType,
          source: "google_type",
        });
        break;
      }
    }
  }

  for (const [tag, aliases] of Object.entries(DIETARY_ALIASES)) {
    const alias = aliases.find((candidate) => aliasPattern(candidate).test(website));
    if (alias) {
      dietaryTags.add(tag);
      evidence.push({ tag, matchedAlias: alias, source: "website" });
    }
  }

  const sources = new Set(evidence.map(({ source }) => source));
  const confidence =
    cuisines.size === 0
      ? 0
      : Math.min(1, 0.55 + (sources.size > 1 ? 0.25 : 0) + (evidence.length > 1 ? 0.1 : 0));
  return {
    cuisines: [...cuisines].sort(),
    dietaryTags: [...dietaryTags].sort(),
    evidence,
    confidence,
  };
}