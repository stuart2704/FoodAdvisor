import assert from "node:assert/strict";
import test from "node:test";
import { DirectEmailDisabledError, sendEmail } from "./sendEmail.ts";

test("direct replies fail explicitly without claiming delivery", async () => {
  await assert.rejects(
    sendEmail("google-place-id", "restaurant@example.com", "Information", "A basic listing is free."),
    (error: unknown) => error instanceof DirectEmailDisabledError
      && error.code === "DIRECT_EMAIL_DISABLED"
      && error.message.includes("No email was queued or sent"),
  );
});

test("direct reply entry point rejects invalid input and unresolved templates", async () => {
  for (const args of [
    ["", "restaurant@example.com", "Subject", "Body"],
    ["place-id", "not-an-email", "Subject", "Body"],
    ["place-id", "restaurant@example.com", "Subject\r\nBcc: other@example.com", "Body"],
    ["place-id", "restaurant@example.com", "Subject", ""],
    ["place-id", "restaurant@example.com", "Subject", "Hi {{restaurant_name}}"],
    ["place-id", "restaurant@example.com", "{{upgrade_link}}", "Body"],
  ]) {
    await assert.rejects(
      sendEmail(...args as [string, string, string, string]),
      (error: unknown) => error instanceof Error && !(error instanceof DirectEmailDisabledError),
    );
  }
});