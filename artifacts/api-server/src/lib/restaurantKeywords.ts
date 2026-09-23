export const cuisineKeywords = {
  italian: ["italian", "pasta", "pizza", "ristorante", "trattoria"],
  indian: ["indian", "curry", "tandoori", "masala", "biryani"],
  chinese: ["chinese", "dumpling", "noodle", "szechuan"],
  japanese: ["japanese", "sushi", "ramen", "izakaya"],
  thai: ["thai", "pad thai", "green curry"],
  mexican: ["mexican", "taco", "burrito", "quesadilla"],
  american: ["american", "burger", "bbq", "steakhouse"],
  french: ["french", "bistro", "brasserie"],
  mediterranean: ["mediterranean", "mezze", "hummus"],
  middle_eastern: ["middle eastern", "shawarma", "falafel"],
  greek: ["greek", "gyros", "souvlaki"],
  spanish: ["spanish", "tapas", "paella"],
  korean: ["korean", "kimchi", "bibimbap"],
  vietnamese: ["vietnamese", "pho", "banh mi"],
} as const;

// Vocabulary only. Do not infer operational amenities from a Maps search page
// or a restaurant name; they require venue-specific, verified evidence.
export const amenityKeywords = {
  vegan: ["vegan", "plant-based"],
  vegetarian: ["vegetarian"],
  halal: ["halal"],
  gluten_free: ["gluten-free", "gluten free"],
  wheelchair: ["wheelchair", "accessible"],
  delivery: ["delivery", "deliveroo", "ubereats"],
  takeaway: ["takeaway", "take-out", "take out"],
  outdoor_seating: ["outdoor seating", "patio", "terrace"],
} as const;

function includesWholePhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

/** Accept only text verified to belong to one venue, not a full Maps page. */
export function classify(rawText: string): { cuisines: string[]; amenities: string[] } {
  if (typeof rawText !== "string") throw new Error("Venue text must be a string.");
  return {
    cuisines: Object.entries(cuisineKeywords)
      .filter(([, keywords]) => keywords.some((keyword) => includesWholePhrase(rawText, keyword)))
      .map(([cuisine]) => cuisine),
    amenities: Object.entries(amenityKeywords)
      .filter(([, keywords]) => keywords.some((keyword) => includesWholePhrase(rawText, keyword)))
      .map(([amenity]) => amenity),
  };
}

/** Name-only fallback when Places has no cuisine-specific type. */
export function cuisineFromRestaurantName(name: string): string[] {
  return classify(name).cuisines.map((cuisine) => cuisine.replace(/_/g, " "));
}