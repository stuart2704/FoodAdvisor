import type { PublishInput, PublishResult } from "./facebook.adapter";

const graph = "https://graph.instagram.com/v26.0";
async function request(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data: any = await response.json();
    if (!response.ok || data.error || !data) throw new Error(`Instagram API rejected request (${response.status}).`);
    return data;
  } finally { clearTimeout(timer); }
}

export const instagramAdapter = {
  async publishPhoto(input: PublishInput): Promise<PublishResult> {
    if (!input.pageId || !input.mediaUrl || !input.mediaUrl.startsWith("https://"))
      throw new Error("Instagram requires an approved public HTTPS image.");
    const headers = { Authorization: `Bearer ${input.token}` };
    const container = await request(`${graph}/${encodeURIComponent(input.pageId)}/media`, {
      method: "POST", headers, body: new URLSearchParams({ image_url: input.mediaUrl, caption: input.content }),
    });
    if (typeof container.id !== "string") throw new Error("Instagram did not return a media container.");
    let ready = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const status = await request(`${graph}/${encodeURIComponent(container.id)}?fields=status_code`, { headers });
      if (status.status_code === "FINISHED") { ready = true; break; }
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!ready) throw new Error("Instagram media was not ready. Check the account before retrying.");
    const published = await request(`${graph}/${encodeURIComponent(input.pageId)}/media_publish`, {
      method: "POST", headers, body: new URLSearchParams({ creation_id: container.id }),
    });
    if (typeof published.id !== "string") throw new Error("Instagram publish outcome is uncertain.");
    return { providerPostId: published.id };
  },
  async publishVideo(): Promise<never> { throw new Error("Instagram video upload is not configured."); },
  async refreshToken(token: string) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    const result = await request(url.toString(), { method: "GET" });
    if (typeof result.access_token !== "string" || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
      throw new Error("Instagram did not return a refreshed token.");
    return { token: result.access_token as string, expiresAt: new Date(Date.now() + result.expires_in * 1000) };
  },
};