import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("./replyClassifier.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { classifyReplyIntent } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("recognises the requested reply labels", () => {
  for (const [text, expected] of [
    ["Yes", "positive"],
    ["interested", "positive"],
    ["sounds good", "positive"],
    ["tell me more", "positive"],
    ["more info", "positive"],
    ["send details", "positive"],
    ["Yes, how do we upgrade?", "upgrade_request"],
    ["send the link", "upgrade_request"],
    ["paid version", "upgrade_request"],
    ["priority placement", "upgrade_request"],
    ["Yes, how do menus work?", "menu_request"],
    ["add menu", "menu_request"],
    ["show me the app", "app_question"],
    ["details", "followup"],
    ["can you explain", "followup"],
    ["what does this involve", "followup"],
    ["yesterday", "unclear"],
    ["happy", "unclear"],
    ["", "unclear"],
  ]) assert.equal(classifyReplyIntent(text), expected, text);
});

test("opt-outs override all sales topics without matching arbitrary substrings", () => {
  for (const text of [
    "not interested", "No", "remove", "unsubscribe",
    "Yes, but unsubscribe me", "Not interested in the app or menu",
    "Remove us, even though priority placement sounds good",
    "I don't want to upgrade",
  ]) assert.equal(classifyReplyIntent(text), "negative", text);
  assert.equal(classifyReplyIntent("I know about your menu"), "menu_request");
  assert.equal(classifyReplyIntent("Remove a menu photo"), "menu_request");
});

test("quoted history, signatures and uncertainty do not create interest", () => {
  assert.equal(classifyReplyIntent("Thanks\nOn Monday Stuart wrote:\nsend the link"), "unclear");
  assert.equal(classifyReplyIntent("Thanks<blockquote>upgrade</blockquote>"), "unclear");
  assert.equal(classifyReplyIntent("Thanks\n--\nMobile app team"), "unclear");
  assert.equal(classifyReplyIntent("Not sure whether we want to upgrade"), "unclear");
});

test("topic-specific follow-ups are honest drafts without a paid checkout link", async () => {
  const result = await build({
    entryPoints: [new URL("./replyGenerator.ts", import.meta.url).pathname],
    bundle: true, write: false, platform: "node", format: "esm",
  });
  const { generateReplyMessage } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const upgrade = generateReplyMessage("upgrade_request", {});
  assert.match(upgrade.body, /Paid verification is currently unavailable/);
  assert.doesNotMatch(upgrade.body, /https?:\/\/|£99/);
  assert.match(generateReplyMessage("menu_request", {}).body, /link to your current menu/);
  assert.match(generateReplyMessage("app_question", {}).body, /confirm availability/);
  assert.match(generateReplyMessage("positive", {}).subject, /next steps/);
  assert.match(generateReplyMessage("followup", {}).subject, /explain/);
});