// Run with: node scripts/activateWatch.js
// Uses existing environment configuration; never put credentials in this file.
async function main() {
  const rawUrl = process.env.PUBLIC_APP_URL;
  const token = process.env.AUTOMATION_TOKEN;
  if (!rawUrl || !token || token.length < 32) {
    throw new Error("PUBLIC_APP_URL and a valid AUTOMATION_TOKEN must be configured.");
  }

  const origin = new URL(rawUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("PUBLIC_APP_URL must be a plain HTTPS origin.");
  }

  const endpoint = new URL("/admin/activate-gmail-watch", origin);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Gmail Watch activation failed (HTTP ${response.status}). Check publishing, authentication, and server logs.`,
    );
  }
  const body = await response.json();
  if (body?.ok !== true || !body.result) {
    throw new Error("The server did not confirm Gmail Watch activation.");
  }
  console.log("Gmail Watch activated or renewed successfully.");
}

main().catch((error) => {
  // Do not print provider responses, request headers, or nested error objects.
  console.error(
    error instanceof Error && error.message.startsWith("Gmail Watch activation failed")
      ? error.message
      : "Gmail Watch activation did not complete. Check configuration and server logs.",
  );
  process.exitCode = 1;
});