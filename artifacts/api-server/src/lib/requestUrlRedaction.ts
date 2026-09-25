export function redactRequestUrl(url: string): string {
  return url
    .split("?")[0]
    .replace(/(\/claim\/[^/]+\/)[^/]+(?=\/?$)/, "$1[REDACTED]");
}