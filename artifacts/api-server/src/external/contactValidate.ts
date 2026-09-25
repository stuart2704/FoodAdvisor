export function validatePhone(phone: string | null): string | null {
  if (!phone) return null;

  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.length < 7 ? null : cleaned;
}

export function validateWebsite(url: string | null): string | null {
  if (!url) return null;

  try {
    const u = new URL(url);
    return u.href;
  } catch {
    return null;
  }
}