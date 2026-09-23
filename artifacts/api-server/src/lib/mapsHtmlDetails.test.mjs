import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDetails } from "./mapsHtmlDetails.ts";

test("extracts available fields and keyword candidates from supplied HTML", () => {
  assert.deepEqual(extractDetails(`
    <body>
      <h1>Italian Trattoria</h1><p>Vegan menu</p>
      <button data-item-id="address"> 10 Main Street </button>
      <button data-item-id="phone"> 0123 456 789 </button>
      <a data-item-id="authority" href="https://example.com">Website</a>
      <span class="Yr7JMd">1,234 reviews</span><span class="mgrRtf">££</span>
    </body>`), {
    address: "10 Main Street",
    phone: "0123 456 789",
    website: "https://example.com",
    review_count: 1234,
    price_level: "££",
    cuisines: ["italian"],
    amenities: ["vegan"],
  });
});

test("missing details stay unknown rather than inventing review counts or unsafe links", () => {
  const result = extractDetails(`<body><a data-item-id="authority" href="javascript:alert(1)">x</a></body>`);
  assert.equal(result.address, null);
  assert.equal(result.review_count, null);
  assert.equal(result.website, null);
});