/**
 * NetaWatch — Daily Auto-Refresh Worker
 * =======================================
 * Runs every night via Vercel Cron (free tier)
 * Fetches news + court updates for every politician in the DB
 * Stores results in Supabase politician_live table
 *
 * Setup: add to vercel.json (see below), set SUPABASE env vars in Vercel dashboard
 */

// app/api/cron/refresh/route.js
// ------------------------------------
// This file goes in: app/api/cron/refresh/route.js

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key (not anon key) for write access
);

// Vercel cron auth check
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all politicians from DB
    const { data: politicians, error } = await supabase
      .from("politicians")
      .select("id, name, constituency")
      .order("name");

    if (error) throw error;

    console.log(`Refreshing ${politicians.length} politicians...`);
    let updated = 0;

    // Process in batches of 10 to avoid rate limits
    for (let i = 0; i < politicians.length; i += 10) {
      const batch = politicians.slice(i, i + 10);

      await Promise.all(batch.map(async (p) => {
        try {
          const [news, courtUpdates] = await Promise.all([
            fetchNews(p.name),
            fetchCourtNews(p.name),
          ]);

          await supabase
            .from("politician_live")
            .upsert({
              id:            p.id,
              news,
              court_updates: courtUpdates,
              last_fetched:  new Date().toISOString(),
            }, { onConflict: "id" });

          updated++;
        } catch (err) {
          console.warn(`Failed ${p.name}:`, err.message);
        }
      }));

      // Small delay between batches
      await new Promise(r => setTimeout(r, 500));
    }

    return Response.json({
      success: true,
      updated,
      total:   politicians.length,
      time:    new Date().toISOString(),
    });

  } catch (err) {
    console.error("Cron error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// ── Fetch recent news via Google News RSS ─────────────────────────────────────
async function fetchNews(name) {
  try {
    const q   = encodeURIComponent(`"${name}" India`);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const xml   = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items.slice(0, 5).map(m => {
      const t       = m[1];
      const title   = (t.match(/<title><!\[CDATA\[(.*?)\]\]>/) || t.match(/<title>(.*?)<\/title>/))?.[1] || "";
      const link    = t.match(/<link>(.*?)<\/link>/)?.[1] || "";
      const pubDate = t.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
      const source  = t.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "News";
      return {
        title:   title.replace(/&amp;/g, "&").trim(),
        link,
        pubDate: pubDate ? new Date(pubDate).toLocaleDateString("en-IN") : "",
        source,
      };
    }).filter(n => n.title.length > 5);
  } catch { return []; }
}

// ── Fetch court-related news ──────────────────────────────────────────────────
async function fetchCourtNews(name) {
  try {
    const q   = encodeURIComponent(`"${name}" court case hearing ED CBI FIR`);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const xml   = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items
      .map(m => {
        const t       = m[1];
        const title   = (t.match(/<title><!\[CDATA\[(.*?)\]\]>/) || t.match(/<title>(.*?)<\/title>/))?.[1] || "";
        const pubDate = t.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
        return { title: title.replace(/&amp;/g, "&").trim(), pubDate: pubDate ? new Date(pubDate).toLocaleDateString("en-IN") : "" };
      })
      .filter(n => /court|case|hearing|FIR|ED|CBI|arrest|bail|verdict|charge/i.test(n.title))
      .slice(0, 3);
  } catch { return []; }
}
