const storageKey = "ownerPortalAccess";

export function portalToken(): string {
  try {
    return sessionStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function setPortalToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid owner access link");
  sessionStorage.setItem(storageKey, token);
}

export function portalPath(section = ""): string {
  return `/portal${section ? `/${section}` : ""}`;
}