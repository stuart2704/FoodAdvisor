import { createHash, timingSafeEqual } from "node:crypto";

function validBearerToken(header: string | undefined, expected: string | undefined): boolean {
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

export function validAutomationToken(header: string | undefined): boolean {
  return validBearerToken(header, process.env.AUTOMATION_TOKEN);
}

export function validSocialAutomationToken(header: string | undefined): boolean {
  return validBearerToken(header, process.env.SOCIAL_AUTOMATION_TOKEN);
}