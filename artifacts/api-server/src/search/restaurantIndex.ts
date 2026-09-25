import { Client } from "@elastic/elasticsearch";

export const RESTAURANT_INDEX = "restaurants";

export const restaurantMappings = {
  properties: {
    name: { type: "text" },
    address: { type: "text" },
    cuisine: { type: "keyword" },
    rank: { type: "integer" },
    region: { type: "keyword" },
  },
} as const;

let client: Client | null = null;

export function getRestaurantSearchClient(): Client {
  if (client) return client;
  const node = process.env.ELASTICSEARCH_URL?.trim();
  const apiKey = process.env.ELASTICSEARCH_API_KEY?.trim();
  if (!node || !apiKey) {
    throw new Error("ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY must be configured to index restaurants.");
  }
  const url = new URL(node);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Elasticsearch must use HTTPS with credentials provided separately.");
  }
  client = new Client({ node: url.href, auth: { apiKey } });
  return client;
}

/** Run after connecting to a cluster. Never overwrites an existing index. */
export async function createRestaurantIndex(): Promise<boolean> {
  const es = getRestaurantSearchClient();
  if (await es.indices.exists({ index: RESTAURANT_INDEX })) return false;
  await es.indices.create({ index: RESTAURANT_INDEX, mappings: restaurantMappings });
  return true;
}