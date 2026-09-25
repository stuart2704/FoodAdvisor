// Operational group labels, not statements about EU membership or data rights.
export const regions = {
  eu: ["uk", "france", "germany", "italy"],
  us: ["usa"],
  apac: ["japan", "australia", "singapore"],
} as const;

export function regionForCountry(country: string): keyof typeof regions | null {
  for (const [region, countries] of Object.entries(regions)) {
    if ((countries as readonly string[]).includes(country)) {
      return region as keyof typeof regions;
    }
  }
  return null;
}