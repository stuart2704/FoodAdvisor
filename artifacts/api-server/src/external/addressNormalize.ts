export function normalizeAddress(raw: string | null): string | null {
  if (!raw) return null;

  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/^\s+|\s+$/g, "");
}