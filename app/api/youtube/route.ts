import { NextResponse } from "next/server";
import { fetchYouTube } from "@/lib/youtube";

// Podcast Tracker: the latest public channel and video counts from YouTube. Read-only, and the API key
// never leaves the server. Vercel's edge cache keeps a good result for 10 minutes (Refresh adds ?fresh=
// to skip it). Errors and "not configured" are never cached, so a fixed setting shows on the next load.
export async function GET() {
  const body = await fetchYouTube();
  return NextResponse.json(body, { headers: { "Cache-Control": body.status === "ok" ? "public, s-maxage=600, stale-while-revalidate=600" : "no-store" } });
}
