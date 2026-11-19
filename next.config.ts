import type { NextConfig } from "next";

// The Supabase project, as set in Vercel (tidied the same way as lib/cloud.ts).
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/^["']+|["']+$/g, "").trim()
  .replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Browsers reach Supabase through this app's own address (/sb/…), because some Wi-Fi networks and
  // mobile carriers block *.supabase.co. Vercel passes the requests on to Supabase unchanged.
  async rewrites() {
    return supabase ? [{ source: "/sb/:path*", destination: `${supabase}/:path*` }] : [];
  },
};

export default nextConfig;
