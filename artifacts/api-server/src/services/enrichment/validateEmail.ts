export const ROLE_MAILBOXES = new Set([
  "bookings",
  "catering",
  "contact",
  "enquiries",
  "events",
  "hello",
  "info",
  "office",
  "reservations",
  "restaurant",
  "support",
  "team",
]);

export type EmailValidationResult =
  | { status: "valid"; email: string; reason: "local_checks_passed" }
  | {
      status: "invalid";
      email: null;
      reason:
        | "empty"
        | "invalid_syntax"
        | "invalid_domain"
        | "not_role_mailbox";
    }
  | {
      status: "unknown";
      email: string | null;
      reason: "validation_unavailable";
    };

/**
 * Performs deterministic local validation only. A "valid" result means that
 * syntax, domain shape, and the exact role-mailbox allowlist passed; it is not
 * a claim that the mailbox exists or accepts mail.
 */
export function validateEmail(value: string): EmailValidationResult {
  const email = value
    .trim()
    .toLowerCase()
    .replace(/^mailto:/i, "")
    .split("?")[0]!;
  if (!email) return { status: "invalid", email: null, reason: "empty" };
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(email)
  ) {
    return { status: "invalid", email: null, reason: "invalid_syntax" };
  }

  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const labels = domain.split(".");
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/i.test(label),
    ) ||
    !/^[a-z]{2,63}$/i.test(labels.at(-1)!)
  ) {
    return { status: "invalid", email: null, reason: "invalid_domain" };
  }
  if (!ROLE_MAILBOXES.has(local)) {
    return { status: "invalid", email: null, reason: "not_role_mailbox" };
  }
  return { status: "valid", email, reason: "local_checks_passed" };
}