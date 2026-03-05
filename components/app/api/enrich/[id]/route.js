// app/api/enrich/[id]/route.js
// Called client-side when a politician profile is opened
// Returns live data: court hearings, parliament attendance, recent news

export async function GET(request, { params }) {
  const { id } = params;
  const name = request.nextUrl.searchParams.get("name");
  const constituency = request.nextUrl.searchParams.get("constituency") || "";

  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  // Run all enrichments in parallel
  const [parliament, news, courtStatus] = await Promise.allSettled([
    fetchParliamentData(name),
    fetchNews(name),
    fetchCourtStatus(name),
  ]);

  return Response.json({
    name,
    lastUpdated: new Date().toISOString(),
    parliament:  parliament.status  === "fulfilled" ? parliament.value  : null,
    news:        news.status        === "fulfilled" ? news.value        : [],
    courtStatus: courtStatus.status === "fulfilled" ? courtStatus.value : null,
  });
}

// ── Parliament Activity ───────────────────────────────────────────────────────
// Lok Sabha open data: sansad.in publishes MP attendance and questions
async function fetchParliamentData(name) {
  try {
    // Sansad.in search — public data
    const searchName = encodeURIComponent(name);
    const res = await fetch(
      `https://sansad.in/ls/members/search?name=${searchName}`,
      { headers: { "Accept": "application/json" }, next: { revalidate: 86400 } }
    );

    if (!res.ok) throw new Error("sansad not available");
    const data = await res.json();

    // Extract attendance and questions from member profile
    const member = data?.members?.[0] || data?.[0];
    if (!member) return null;

    return {
      questionsAsked:    member.questions_asked || member.questionsAsked || null,
      debatesParticipated: member.debates       || null,
      attendancePct:     member.attendance_pct  || member.attendancePct  || null,
      memberSince:       member.since           || null,
      profileUrl:        `https://sansad.in/ls/members/${member.id || ""}`,
    };
  } catch {
    // Fallback: return structured null so UI shows "data pending"
    return null;
  }
}

// ── News Enrichment ───────────────────────────────────────────────────────────
// Uses RSS feeds from major Indian news outlets — no API key needed
async function fetchNews(name) {
  const sources = [
    `https://news.google.com/rss/search?q=${encodeURIComponent(name + " India politician")}&hl=en-IN&gl=IN&ceid=IN:en`,
    `https://timesofindia.indiatimes.com/rssfeedstopstories.cms`,
  ];

  try {
    const res = await fetch(sources[0], {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 } // cache 1 hour
    });

    if (!res.ok) return [];

    const xml  = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    return items.slice(0, 5).map(m => {
      const item    = m[1];
      const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                       item.match(/<title>(.*?)<\/title>/))?.[1] || "";
      const link    = (item.match(/<link>(.*?)<\/link>/))?.[1] || "";
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || "";
      const source  = (item.match(/<source[^>]*>(.*?)<\/source>/))?.[1] || "Google News";

      return {
        title:   title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
        link,
        pubDate: pubDate ? new Date(pubDate).toLocaleDateString("en-IN") : "",
        source,
      };
    }).filter(n => n.title && n.title.length > 5);
  } catch {
    return [];
  }
}

// ── Court Status ──────────────────────────────────────────────────────────────
// NJDG doesn't have a public API but we can check if cases are mentioned
// in recent news as a proxy for court activity
async function fetchCourtStatus(name) {
  try {
    const query   = encodeURIComponent(`${name} court case hearing 2024 2025`);
    const res     = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } }
    );

    if (!res.ok) return null;

    const xml   = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    const courtNews = items
      .map(m => {
        const item    = m[1];
        const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1] || "";
        const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || "";
        return { title: title.trim(), pubDate };
      })
      .filter(n =>
        /court|case|hearing|FIR|ED|CBI|arrested|bail|verdict|charge/i.test(n.title)
      )
      .slice(0, 3);

    return courtNews.length > 0 ? courtNews : null;
  } catch {
    return null;
  }
}
