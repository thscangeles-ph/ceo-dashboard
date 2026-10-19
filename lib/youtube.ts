// Server only: reads the API key from the environment. Copied from the THSC Podcast Tracker.
import type { AnalyticsResponse, Video } from "@/lib/podcast";

// YouTube Data API v3 with an API key: public channel and video statistics, no sign-in needed.
// Quota: about 1 unit per call, roughly 25 units for a 500-video channel (the daily free quota is 10,000).
const API = "https://www.googleapis.com/youtube/v3";
const DEFAULT_CHANNEL_ID = "UCger3xrtHXSaVZWfMl6HeoA"; // The Heart Speaks by The Heart Specialists Clinic

type YouTubeVideo = {
  id: string;
  snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

async function call<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `YouTube returned HTTP ${response.status}.`);
  return body as T;
}

const count = (value: string | undefined) => (value === undefined ? null : Number(value));

/** ISO 8601 duration ("PT1H2M3S") to seconds. */
function seconds(duration: string | undefined) {
  const match = duration?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part || 0));
  return d * 86400 + h * 3600 + m * 60 + s;
}

export async function fetchYouTube(): Promise<AnalyticsResponse> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  // Defaults to The Heart Speaks channel; a channel ID is public, only the API key is secret.
  const handle = process.env.YOUTUBE_HANDLE?.trim();
  const channelId = process.env.YOUTUBE_CHANNEL_ID?.trim() || (handle ? "" : DEFAULT_CHANNEL_ID);
  const maxVideos = Number(process.env.YOUTUBE_MAX_VIDEOS) || 500;
  const result: AnalyticsResponse = { status: "ok", channel: null, videos: [], message: "", warnings: [], fetchedAt: new Date().toISOString() };

  if (!key || (!channelId && !handle)) {
    return { ...result, status: "not-configured", message: "The server has no YOUTUBE_API_KEY. Add it in Vercel → this project → Settings → Environment Variables (Production), then redeploy." };
  }

  try {
    const lookup: Record<string, string> = channelId ? { id: channelId } : { forHandle: handle!.startsWith("@") ? handle! : `@${handle}` };
    const channels = await call<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: Record<string, { url: string }> }; statistics: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
      "channels", { part: "snippet,statistics,contentDetails", ...lookup }, key,
    );
    const channel = channels.items?.[0];
    if (!channel) throw new Error(`No YouTube channel found for ${channelId || handle}.`);

    result.channel = {
      name: channel.snippet.title,
      url: channel.snippet.customUrl ? `https://www.youtube.com/${channel.snippet.customUrl}` : `https://www.youtube.com/channel/${channel.id}`,
      avatar: channel.snippet.thumbnails?.default?.url ?? null,
      subscribers: channel.statistics.hiddenSubscriberCount ? null : count(channel.statistics.subscriberCount),
      totalViews: count(channel.statistics.viewCount),
      videoCount: count(channel.statistics.videoCount),
    };

    // Every public upload is in the channel's "uploads" playlist, newest first.
    const ids: string[] = [];
    let pageToken = "";
    do {
      const page = await call<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(
        "playlistItems", { part: "contentDetails", playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}) }, key,
      );
      page.items?.forEach((item) => ids.push(item.contentDetails.videoId));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken && ids.length < maxVideos);

    const batches: string[][] = [];
    for (let index = 0; index < Math.min(ids.length, maxVideos); index += 50) batches.push(ids.slice(index, Math.min(index + 50, maxVideos)));
    const pages = await Promise.all(batches.map((batch) => call<{ items?: YouTubeVideo[] }>("videos", { part: "snippet,statistics,contentDetails", id: batch.join(",") }, key)));

    result.videos = pages.flatMap((page) => page.items ?? []).map((video): Video => ({
      id: video.id,
      title: video.snippet.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      thumbnail: video.snippet.thumbnails?.medium?.url ?? video.snippet.thumbnails?.default?.url ?? null,
      publishedAt: video.snippet.publishedAt,
      durationSec: seconds(video.contentDetails?.duration),
      views: count(video.statistics?.viewCount),
      likes: count(video.statistics?.likeCount),
      comments: count(video.statistics?.commentCount),
      watchHours: null,
      impressions: null,
    }));
    if (ids.length > maxVideos) result.warnings.push(`Showing the newest ${maxVideos} of ${ids.length} YouTube videos (YOUTUBE_MAX_VIDEOS).`);
    return result;
  } catch (cause) {
    return { ...result, status: "error", message: cause instanceof Error ? cause.message : "YouTube could not be reached." };
  }
}
