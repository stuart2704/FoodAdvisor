import type { PublishInput, PublishResult } from "./facebook.adapter";

const api = "https://open.tiktokapis.com";
export async function tiktokRequest(path: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${api}${path}`, { ...init, signal: controller.signal });
    const body: any = await response.json();
    if (!response.ok || !body || (body.error && body.error.code !== "ok"))
      throw new Error(`TikTok request failed (${response.status}).`);
    return body;
  } finally { clearTimeout(timer); }
}
export const tiktokAdapter = {
  async status(token: string, publishId: string) {
    const result = await tiktokRequest("/v2/post/publish/status/fetch/", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    return result.data as { status: string; publicaly_available_post_id?: string[]; fail_reason?: string };
  },
  async creatorInfo(token: string) {
    const result = await tiktokRequest("/v2/post/publish/creator_info/query/", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
    });
    if (!result.data?.creator_nickname || !Array.isArray(result.data.privacy_level_options))
      throw new Error("TikTok creator information is unavailable.");
    return result.data as { creator_nickname: string; privacy_level_options: string[]; comment_disabled: boolean; max_video_post_duration_sec: number };
  },
  async publishPhoto(input: PublishInput & { privacyLevel: string }): Promise<PublishResult> {
    if (!input.mediaUrl?.startsWith("https://")) throw new Error("TikTok requires an approved public HTTPS image.");
    const creator = await this.creatorInfo(input.token);
    if (!creator.privacy_level_options.includes(input.privacyLevel))
      throw new Error("Selected TikTok privacy level is not available for this creator. Review the post again.");
    const result = await tiktokRequest("/v2/post/publish/content/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        post_info: { title: input.content.slice(0, 90), description: input.content, privacy_level: input.privacyLevel, disable_comment: true, auto_add_music: false },
        source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [input.mediaUrl] },
        post_mode: "DIRECT_POST", media_type: "PHOTO",
      }),
    });
    if (typeof result.data?.publish_id !== "string") throw new Error("TikTok did not return a publish ID.");
    return { providerPostId: result.data.publish_id };
  },
  async publishVideo(): Promise<never> { throw new Error("TikTok video upload is not configured."); },
  async refreshToken(refreshToken: string, clientKey: string, clientSecret: string) {
    const result = await tiktokRequest("/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string"
      || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
      throw new Error("TikTok did not return refreshed credentials.");
    return { token: result.access_token as string, refreshToken: result.refresh_token as string, expiresAt: new Date(Date.now() + result.expires_in * 1000) };
  },
};