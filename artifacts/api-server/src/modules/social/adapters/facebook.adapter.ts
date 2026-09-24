export type PublishInput = { token: string; pageId?: string; content: string; mediaUrl?: string; mediaType?: "photo" | "video" };
export type PublishResult = { providerPostId: string };
const graph = "https://graph.facebook.com/v25.0";
async function request(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(`Facebook request failed (${response.status})`);
    return body;
  } finally { clearTimeout(timer); }
}
export const facebookAdapter = {
  async validateConnection(token: string) {
    if (!token) throw new Error("Facebook access token is required.");
    const page = await request(`${graph}/me?fields=id,name,category`, { headers: { Authorization: `Bearer ${token}` } });
    if (typeof page.id !== "string" || typeof page.category !== "string") {
      throw new Error("A Facebook Page access token is required, not a personal account token.");
    }
    return page;
  },
  async publishPhoto(input: PublishInput): Promise<PublishResult> {
    const id = input.pageId; if (!id) throw new Error("Facebook Page ID is required.");
    const body = new URLSearchParams({ message: input.content, access_token: input.token });
    if (input.mediaUrl) body.set("url", input.mediaUrl);
    const response = await request(`${graph}/${id}/${input.mediaUrl ? "photos" : "feed"}`, { method: "POST", body });
    if (typeof response.id !== "string") throw new Error("Facebook did not return a post ID.");
    return { providerPostId: response.id };
  },
  async publishVideo(input: PublishInput): Promise<PublishResult> {
    const id = input.pageId; if (!id || !input.mediaUrl) throw new Error("Facebook Page ID and video URL are required.");
    const body = new URLSearchParams({ description: input.content, file_url: input.mediaUrl, access_token: input.token });
    const response = await request(`${graph}/${id}/videos`, { method: "POST", body });
    if (typeof response.id !== "string") throw new Error("Facebook did not return a video ID.");
    return { providerPostId: response.id };
  },
  async refreshToken(): Promise<never> { throw new Error("Facebook token refresh requires configured OAuth credentials."); },
};