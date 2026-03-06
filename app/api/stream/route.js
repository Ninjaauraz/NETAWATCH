// app/api/stream/route.js — live SSE enrichment feed
import { SEED_POLITICIANS } from "@/lib/seed";
import { scoreBatch } from "@/lib/scoring";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchNewsForPolitician(name) {
  try {
    const q = encodeURIComponent(`"${name}" India politician`);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(m => {
      const s = m[1];
      const title   = (s.match(/<title><!\[CDATA\[(.*?)\]\]>/) || s.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || "";
      const link    = s.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || "#";
      const pubDate = s.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
      const src     = s.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "News";
      const isCourt = /court|case|FIR|ED |CBI|bail|arrested|charge|hearing|verdict|raid/i.test(title);
      return {
        title: title.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").slice(0,120),
        link, src,
        date: pubDate ? new Date(pubDate).toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : "",
        isCourt,
        severity: isCourt ? "high" : "normal",
      };
    }).filter(n => n.title.length > 10);
  } catch { return []; }
}

export async function GET() {
  let politicians = [];
  if (supabase) {
    const { data } = await supabase.from("politicians").select("*");
    if (data?.length) politicians = data;
  }
  if (!politicians.length) politicians = SEED_POLITICIANS;
  const scored = scoreBatch(politicians);

  const enc = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (evt, data) => {
        if (closed) return;
        try { ctrl.enqueue(enc.encode(`event:${evt}\ndata:${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; }
      };

      // Initial payload — all politicians
      send("init", { politicians: scored, ts: Date.now() });

      // Rotate through all politicians, fetching live news
      let idx = 0;
      const shuffled = [...scored].sort(() => Math.random() - 0.5);

      const tick = async () => {
        if (closed) return;
        send("heartbeat", { ts: Date.now(), active: scored.length });

        // Enrich 2 politicians per tick
        const batch = [shuffled[idx % shuffled.length], shuffled[(idx+1) % shuffled.length]];
        idx += 2;

        await Promise.all(batch.map(async p => {
          const news = await fetchNewsForPolitician(p.name);
          if (news.length && !closed) {
            send("news", { id: p.id, name: p.name, news, ts: Date.now() });
          }
        }));
      };

      // First enrichment after 3s
      setTimeout(tick, 3000);
      // Then every 30s
      const interval = setInterval(tick, 30000);

      // Close after 10 min (Vercel limit)
      setTimeout(() => {
        closed = true;
        clearInterval(interval);
        try { ctrl.close(); } catch {}
      }, 600000);
    },
    cancel() { closed = true; }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    }
  });
}
