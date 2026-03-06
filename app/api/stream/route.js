// app/api/stream/route.js — live SSE enrichment feed
// Sends politicians on init, then pushes live news every 30s
import { SEED_POLITICIANS } from "@/lib/seed";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inline scoring so field names match the client's ._s expectation
function computeScore(p) {
  const yrs    = Object.keys(p.totalAssets || {}).sort();
  const latest = p.totalAssets?.[yrs[yrs.length - 1]] || 0;
  const first  = p.totalAssets?.[yrs[0]] || 0;
  const income = Object.values(p.declaredIncome || {}).reduce((a, b) => a + b, 0);
  const cases  = p.criminalCases || [];
  const pending= cases.filter(c => c.status === "PENDING");
  const dropped= cases.filter(c => c.status === "DROPPED");

  let wealth = 0;
  if (yrs.length >= 2 && income > 0) {
    const r = (latest - first) / income;
    wealth = r<=1?r*18 : r<=5?18+(r-1)/4*30 : r<=15?48+(r-5)/10*27 : Math.min(75+(r-15)/15*15, 96);
  } else {
    wealth = latest<=4.5?(latest/4.5)*17 : latest<=50?17+(latest-4.5)/45.5*43 : Math.min(60+(latest-50)/200*36, 97);
  }

  let caseScore = Math.min(pending.length*12 + pending.filter(c=>/ED|CBI|murder|launder|benami/i.test(c.case||"")).length*14, 100);
  if (dropped.length && (p.partyHistory?.length||0) > 1) {
    const switchYrs = p.partyHistory.slice(1).map(x=>x.from);
    dropped.forEach(d => { if (d.resolvedYear && switchYrs.some(y=>Math.abs(d.resolvedYear-y)<=2)) caseScore=Math.min(caseScore+20,100); });
  }

  const NW = {spouse:1,child:.9,sibling:.7,associate:.8,shell_company:1};
  let netRisk = 0;
  (p.network||[]).forEach(n=>{
    const w=NW[n.type]||.5;
    netRisk+=((n.tradeBeforePolicy?38:0)+(n.govtContractWon?32+Math.min(Math.log10(Math.max(n.contractValueCr||1,1))*6,18):0)+(n.holdingsInConflictSectors?20:0))*w;
  });
  const networkScore = Math.min((netRisk/Math.max((p.network||[]).length,1)/100)*150,100);

  const tradeScore = !(p.tradeEvents?.length)?0:Math.min(
    (p.tradeEvents||[]).map(e=>{const d=(new Date(e.policyDate)-new Date(e.date))/86400000;return d<=0?0:d<=30?92:d<=90?68:d<=180?38:14;})
    .sort((a,b)=>b-a).reduce((s,v,i)=>s+(i===0?v:v*.25),0),100);

  const disc=p.disclosure||{};
  const discScore=Math.min((disc.lateFilings||0)*8+(disc.amendmentsAfterMedia||0)*18+(disc.assetsFoundInAudit||0)*28+(disc.missingYears||0)*22,100);

  const final=Math.round(wealth*.28+caseScore*.22+networkScore*.18+tradeScore*.16+discScore*.10+Math.min((p.holdings||[]).filter(h=>h.conflict).length*16,100)*.06);
  const tier=final>=80?"critical":final>=60?"high":final>=38?"elevated":final>=18?"low":"clear";

  return { final, tier, wealth:Math.round(wealth), cases:caseScore, network:Math.round(networkScore), trades:Math.round(tradeScore), disclosure:discScore, netWorth:latest, pendingCases:pending.length, unexplained:Math.max(0,latest-4.5) };
}

function scoreBatch(arr) {
  return arr.map(p=>({...p,_s:computeScore(p)})).sort((a,b)=>b._s.final-a._s.final);
}

async function fetchNews(name) {
  try {
    const q   = encodeURIComponent(`"${name}" India politician`);
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,5).map(m=>{
      const s=m[1];
      const title=(s.match(/<title><!\[CDATA\[(.*?)\]\]>/)||s.match(/<title>(.*?)<\/title>/))?.[1]?.trim()||"";
      const link=s.match(/<link>(.*?)<\/link>/)?.[1]?.trim()||"#";
      const pubDate=s.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]||"";
      const src=s.match(/<source[^>]*>(.*?)<\/source>/)?.[1]||"News";
      const isCourt=/court|case|FIR|ED |CBI|bail|arrested|charge|hearing|verdict|raid/i.test(title);
      return {
        title:title.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").slice(0,130),
        link, src, isCourt,
        date:pubDate?new Date(pubDate).toLocaleDateString("en-IN",{day:"numeric",month:"short"}):"",
      };
    }).filter(n=>n.title.length>10);
  } catch { return []; }
}

export async function GET() {
  let raw = [];
  if (supabase) {
    const { data } = await supabase.from("politicians").select("*");
    if (data?.length) raw = data;
  }
  if (!raw.length) raw = SEED_POLITICIANS;
  const scored   = scoreBatch(raw);
  const shuffled = [...scored].sort(()=>Math.random()-.5);

  const enc    = new TextEncoder();
  let closed   = false;
  let idx      = 0;

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (evt, data) => {
        if (closed) return;
        try { ctrl.enqueue(enc.encode(`event:${evt}\ndata:${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; }
      };

      // Send all politicians immediately
      send("init", { politicians: scored });

      const tick = async () => {
        if (closed) return;
        send("heartbeat", { ts: Date.now() });
        // Enrich 2 random politicians per tick
        const a = shuffled[idx % shuffled.length];
        const b = shuffled[(idx+1) % shuffled.length];
        idx += 2;
        const [na, nb] = await Promise.all([fetchNews(a.name), fetchNews(b.name)]);
        if (na.length) send("news", { id: a.id, news: na });
        if (nb.length) send("news", { id: b.id, news: nb });
      };

      setTimeout(tick, 4000);
      const iv = setInterval(tick, 30000);
      setTimeout(() => { closed=true; clearInterval(iv); try{ctrl.close()}catch{} }, 580000);
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
