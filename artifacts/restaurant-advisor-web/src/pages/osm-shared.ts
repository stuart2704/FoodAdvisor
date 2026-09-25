export const OWNER_SESSION_KEY = "tfa.osm.ownerSession";

export function ownerSession() {
  return sessionStorage.getItem(OWNER_SESSION_KEY);
}

export function clearOwnerSession() {
  sessionStorage.removeItem(OWNER_SESSION_KEY);
}

export function ownerRequest() {
  const session = ownerSession();
  return { headers: { Authorization: `Bearer ${session ?? ""}` }, credentials: "include" as const, referrerPolicy: "no-referrer" as const };
}

export const adminRequest = { credentials: "include" as const };

export function isUnauthorized(error: unknown) {
  return (error as { status?: number; response?: { status?: number } })?.status === 401 ||
    (error as { response?: { status?: number } })?.response?.status === 401;
}

export function readableError(error: unknown) {
  if (isUnauthorized(error)) return "Your session has expired. Please sign in again.";
  const status = (error as { status?: number; response?: { status?: number } })?.status ??
    (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return "You do not have permission to make this change.";
  if (status === 409) return "This step cannot be completed yet. Check the requirements and refresh.";
  if (status === 429) return "Too many attempts. Please wait before trying again.";
  return "We could not complete that request. Please try again.";
}