"use client";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ─── SCORING ENGINE (inline, works with single-year ECI data) ─────────────────
const WEIGHTS = { wealth:0.28, cases:0.22, network:0.18, disclosure:0.12, timing:0.12, conflict:0.08 };

function scoreWealth({ totalAssets, declaredIncome }) {
  const vals   = Object.values(totalAssets || {});
  const years  = Object.keys(totalAssets || {}).map(Number).sort();
  const latest = vals[vals.length - 1] || 0;
  const declared = Object.values(declaredIncome || {}).reduce((a, b) => a + b, 0);
  if (years.length >= 2) {
    const growth = latest - (totalAssets[years[0]] || 0);
    if (declared > 0) {
      const r = growth / declared;
      if (r <= 1)  return Math.round(r * 18);
      if (r <= 5)  return Math.round(18 + ((r-1)/4)*30);
      if (r <= 15) return Math.round(48 + ((r-5)/10)*27);
      if (r <= 30) return Math.round(75 + ((r-15)/15)*15);
      return 95;
    }
  }
  // Single year: score vs ₹4.5Cr lifetime public salary ceiling
  if (latest <= 1)   return 5;
  if (latest <= 4.5) return Math.round(5 + (latest/4.5)*12);
  if (latest <= 15)  return Math.round(17 + ((latest-4.5)/10.5)*20);
  if (latest <= 50)  return Math.round(37 + ((latest-15)/35)*25);
  if (latest <= 200) return Math.round(62 + ((latest-50)/150)*20);
  return Math.min(82 + Math.round((latest-200)/100), 96);
}

function scoreCases({ criminalCases, partyHistory }) {
  if (!criminalCases?.length) return 0;
  const pending = criminalCases.filter(c => c.status === "PENDING");
  const serious = pending.filter(c => /302|307|ED|CBI|launder|benami|murder|rape|dacoity|terror/i.test(c.case + (c.note||"")));
  const dropped = criminalCases.filter(c => c.status === "DROPPED" && c.resolvedYear);
  let s = Math.min(pending.length * 11, 55) + Math.min(serious.length * 14, 35);
  if (dropped.length && partyHistory?.length > 1) {
    const switches = partyHistory.slice(1).map(p => p.from);
    dropped.forEach(c => {
      if (switches.some(yr => Math.abs(c.resolvedYear - yr) <= 2)) s += 18;
    });
  }
  return Math.min(s, 100);
}

function scoreNetwork({ network }) {
  if (!network?.length) return 0;
  const W = { spouse:1.0, child:0.9, sibling:0.7, parent:0.6, associate:0.8, shell_company:1.0 };
  let total = 0;
  network.forEach(n => {
    const w = W[n.type] || 0.5;
    let s = 0;
    if (n.holdingsInConflictSectors) s += 25;
    if (n.tradeBeforePolicy)         s += 35;
    if (n.govtContractWon)           s += 30 + Math.min(Math.log10(Math.max(n.contractValueCr||1,1))*5, 15);
    total += s * w;
  });
  return Math.min(Math.round((total / (network.length * 100)) * 150), 100);
}

function scoreDisclosure({ disclosure }) {
  if (!disclosure) return 0;
  const { lateFilings=0, amendmentsAfterMedia=0, assetsFoundInAudit=0, missingYears=0 } = disclosure;
  return Math.min(lateFilings*8 + amendmentsAfterMedia*15 + assetsFoundInAudit*25 + missingYears*20, 100);
}

function scoreTiming({ tradeEvents }) {
  if (!tradeEvents?.length) return 0;
  const scores = tradeEvents.map(e => {
    const days = (new Date(e.policyDate) - new Date(e.date)) / 86400000;
    if (days <= 0) return 0;
    let s = days<=30?90 : days<=90?65 : days<=180?35 : days<=365?15 : 5;
    return s * Math.min(1 + Math.log10(Math.max(e.valueCr,0.1))*0.1, 1.3);
  }).sort((a,b) => b-a);
  return Math.min(Math.round(scores[0] + scores.slice(1).reduce((s,v) => s+v*0.2, 0)), 100);
}

function scoreConflict({ holdings }) {
  if (!holdings?.length) return 0;
  const total = holdings.reduce((s,h) => s+h.value, 0);
  const bad   = holdings.filter(h=>h.conflict).reduce((s,h) => s+h.value, 0);
  const pct   = total > 0 ? (bad/total)*100 : 0;
  return Math.min(Math.round(pct*0.85) + holdings.filter(h=>h.conflict).length*5, 100);
}

function computeScore(p) {
  const sub = {
    wealth:     scoreWealth(p),
    cases:      scoreCases(p),
    network:    scoreNetwork(p),
    disclosure: scoreDisclosure(p),
    timing:     scoreTiming(p),
    conflict:   scoreConflict(p),
  };
  const final = Math.round(Object.entries(WEIGHTS).reduce((s,[k,w]) => s+sub[k]*w, 0));
  const tier = final >= 80 ? "CRITICAL" : final >= 60 ? "HIGH" : final >= 40 ? "ELEVATED" : final >= 20 ? "LOW" : "CLEAR";
  return { final, sub, tier };
}

export function scoreBatch(arr) {
  return arr.map(p => ({ ...p, score: computeScore(p) })).sort((a,b) => b.score.final - a.score.final);
}

// ─── COLOUR SYSTEM ────────────────────────────────────────────────────────────
const TIER_COLOR = { CRITICAL:"#FF1A1A", HIGH:"#FF6B00", ELEVATED:"#FFB800", LOW:"#4ADE80", CLEAR:"#22D3EE" };
const PARTY_HUE  = { BJP:"#FF5722", INC:"#2196F3", TMC:"#009688", AAP:"#00BCD4", NCP:"#9C27B0",
  SP:"#FF5252", BSP:"#1565C0", DMK:"#D32F2F", JDU:"#00838F", RJD:"#E91E63",
  CPI:"#C62828", AAP:"#00ACC1", IND:"#78909C" };
const pColor = p => PARTY_HUE[p?.toUpperCase()] || "#78909C";

function proxyPhoto(url) {
  if (!url) return "";
  if (url.includes("weserv.nl")) return url;
  if (url.includes("wikimedia") || url.includes("wikipedia"))
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=200&h=200&fit=cover`;
  return url;
}

// ─── FONT LOADER ──────────────────────────────────────────────────────────────
function useFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;800&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap";
    document.head.appendChild(link);
  }, []);
}

// ─── THREAT METER ─────────────────────────────────────────────────────────────
function ThreatMeter({ score, tier }) {
  const color = TIER_COLOR[tier];
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let v = 0;
    const step = score / 40;
    const t = setInterval(() => {
      v = Math.min(v + step, score);
      setDisplay(Math.round(v));
      if (v >= score) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [score]);

  const segments = 20;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:48, fontWeight:800,
        color, lineHeight:1, textShadow:`0 0 30px ${color}88`, letterSpacing:-2 }}>
        {String(display).padStart(2,"0")}
      </div>
      <div style={{ display:"flex", gap:2 }}>
        {Array.from({length:segments}).map((_,i) => {
          const filled = i < Math.round((score/100)*segments);
          const segColor = i < 8 ? "#4ADE80" : i < 13 ? "#FFB800" : i < 17 ? "#FF6B00" : "#FF1A1A";
          return (
            <div key={i} style={{ width:6, height:24, borderRadius:1,
              background: filled ? segColor : "#1A1A1A",
              boxShadow: filled ? `0 0 6px ${segColor}88` : "none",
              transition:`all ${0.02*i}s ease` }}/>
          );
        })}
      </div>
      <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:14, letterSpacing:3,
        color, textShadow:`0 0 10px ${color}` }}>{tier}</div>
    </div>
  );
}

// ─── SCANLINES BOOT EFFECT ────────────────────────────────────────────────────
function ScanEffect() {
  const [show, setShow] = useState(true);
  useEffect(() => { setTimeout(() => setShow(false), 1800); }, []);
  if (!show) return null;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, pointerEvents:"none",
      background:"#000", animation:"fadeout 0.4s 1.4s forwards" }}>
      <div style={{ position:"absolute", inset:0,
        backgroundImage:"repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
        animation:"scandown 1.4s linear" }}/>
      <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
        fontFamily:"'JetBrains Mono',monospace", color:"#FF1A1A", fontSize:11, letterSpacing:3,
        textAlign:"center", lineHeight:2 }}>
        <div style={{marginBottom:8}}>NETAWATCH INTELLIGENCE SYSTEM</div>
        <div style={{color:"#333"}}>LOADING CLASSIFIED DATA...</div>
        <div style={{color:"#222", marginTop:4}}>AUTHORISED ACCESS ONLY</div>
      </div>
    </div>
  );
}

// ─── REDACT ───────────────────────────────────────────────────────────────────
function Redact({ children, reveal=false }) {
  const [open, setOpen] = useState(reveal);
  if (open) return <span>{children}</span>;
  return (
    <span onClick={() => setOpen(true)} title="Click to reveal" style={{
      background:"#222", color:"transparent", borderRadius:2, cursor:"pointer",
      userSelect:"none", padding:"0 2px", letterSpacing:-1,
      border:"1px solid #333",
    }}>{"█".repeat(String(children).length)}</span>
  );
}

// ─── EVIDENCE CHAIN (timeline) ────────────────────────────────────────────────
function EvidenceChain({ timeline }) {
  if (!timeline?.length) return (
    <div style={{color:"#444", fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:"20px 0"}}>
      NO TIMELINE DATA ON RECORD
    </div>
  );

  const typeColor = { party:"#9B59B6", legal:"#FF1A1A", appt:"#3498DB", trade:"#F39C12",
    policy:"#555", gain:"#2ECC71", contract:"#FF1A1A" };

  return (
    <div style={{ position:"relative", paddingLeft:24 }}>
      {/* Vertical wire */}
      <div style={{ position:"absolute", left:8, top:8, bottom:8, width:1,
        background:"linear-gradient(to bottom, transparent, #FF1A1A44, #FF1A1A44, transparent)" }}/>

      {timeline.map((t, i) => {
        const color = typeColor[t.type] || "#555";
        return (
          <div key={i} style={{ display:"flex", gap:16, marginBottom:20, position:"relative" }}>
            {/* Node */}
            <div style={{ position:"absolute", left:-20, top:4, width:10, height:10, borderRadius:"50%",
              background: t.flag ? "#FF1A1A" : color,
              boxShadow: t.flag ? "0 0 12px #FF1A1A" : "none",
              border:`2px solid ${color}`,
              flexShrink:0, zIndex:1,
              animation: t.flag ? "pulse-red 1.5s infinite" : "none" }}/>

            <div style={{ flex:1, background:"#0F0F0F", border:`1px solid ${t.flag ? "#FF1A1A33" : "#1E1E1E"}`,
              borderRadius:4, padding:"10px 14px",
              boxShadow: t.flag ? "0 0 20px #FF1A1A11" : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#444",
                  textTransform:"uppercase", letterSpacing:1 }}>{t.date}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color,
                  textTransform:"uppercase", letterSpacing:2,
                  border:`1px solid ${color}22`, padding:"1px 6px", borderRadius:2 }}>{t.type}</span>
              </div>
              <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:14, color: t.flag ? "#FFF" : "#AAA",
                lineHeight:1.5 }}>
                {t.flag && <span style={{color:"#FF1A1A",marginRight:6}}>▲</span>}
                {t.event}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ASSET CHART ──────────────────────────────────────────────────────────────
function AssetChart({ totalAssets, liabilities }) {
  const years = Object.keys(totalAssets || {}).sort();
  if (years.length < 2) {
    // Single year — comparison bars
    const val = Object.values(totalAssets||{})[0] || 0;
    const maxV = Math.max(val, 15);
    return (
      <div>
        {[["DECLARED NET WORTH", val, "#FF1A1A"], ["AVG MP (ADR 2024)", 14.7, "#444"],
          ["30YR GOVT SALARY", 4.5, "#2A2A2A"]].map(([l,v,c],i) => (
          <div key={i} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"#555",letterSpacing:1}}>{l}</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:c,fontWeight:800}}>₹{v}CR</span>
            </div>
            <div style={{height:6,background:"#111",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${(v/maxV)*100}%`,height:"100%",background:c,
                boxShadow:i===0?`0 0 8px ${c}`:undefined,
                transition:"width 1s ease",borderRadius:2}}/>
            </div>
          </div>
        ))}
        <div style={{marginTop:12,fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"#333",
          borderTop:"1px solid #1A1A1A",paddingTop:8}}>
          EXPLAINABLE GAP: ₹{Math.max(0,val-4.5).toFixed(1)}CR UNEXPLAINED WEALTH
        </div>
      </div>
    );
  }

  const data = years.map(y => ({
    y, assets: totalAssets[y], liab: liabilities?.[y] || 0,
    net: totalAssets[y] - (liabilities?.[y] || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF1A1A" stopOpacity={0.3}/>
            <stop offset="100%" stopColor="#FF1A1A" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="y" tick={{fill:"#444",fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}
          axisLine={false} tickLine={false}/>
        <YAxis tick={{fill:"#444",fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}
          axisLine={false} tickLine={false}/>
        <Tooltip contentStyle={{background:"#111",border:"1px solid #222",
          fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#CCC"}}
          labelStyle={{color:"#555",marginBottom:4}}/>
        <Area dataKey="assets" name="ASSETS" stroke="#FF1A1A" strokeWidth={2}
          fill="url(#redGrad)" dot={{fill:"#FF1A1A",r:3}}/>
        <Area dataKey="liab" name="LIABILITIES" stroke="#333" strokeWidth={1}
          fill="none" strokeDasharray="4 2"/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── SUBJECT CARD (sidebar) ───────────────────────────────────────────────────
function SubjectCard({ p, selected, onClick }) {
  const color  = TIER_COLOR[p.score.tier];
  const pcolor = pColor(p.party);
  const [hov,  setHov]   = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const photo = proxyPhoto(p.photo);

  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ position:"relative", padding:"12px 14px", cursor:"pointer", marginBottom:1,
        background: selected ? "#0F0F0F" : hov ? "#080808" : "transparent",
        borderLeft:`2px solid ${selected ? color : "transparent"}`,
        transition:"all 0.15s", overflow:"hidden" }}>

      {/* Glow on selected */}
      {selected && <div style={{ position:"absolute", left:0, top:0, bottom:0, width:60,
        background:`linear-gradient(to right, ${color}08, transparent)`, pointerEvents:"none" }}/>}

      <div style={{ display:"flex", gap:10, alignItems:"center", position:"relative" }}>
        {/* Photo or initials */}
        <div style={{ width:36, height:36, borderRadius:3, flexShrink:0, overflow:"hidden",
          border:`1px solid #1E1E1E`, filter:"grayscale(100%) contrast(1.1)",
          background:"#111", position:"relative" }}>
          {photo && !imgErr
            ? <img src={photo} alt={p.name} onError={()=>setImgErr(true)}
                style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
                justifyContent:"center",fontFamily:"'Bebas Neue',cursive",
                fontSize:14,color:"#333",letterSpacing:1}}>
                {p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
              </div>}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:600,
            color: selected ? "#FFF" : "#888", overflow:"hidden", textOverflow:"ellipsis",
            whiteSpace:"nowrap", letterSpacing:-0.3 }}>
            {p.name.toUpperCase()}
          </div>
          <div style={{ display:"flex", gap:6, marginTop:3, alignItems:"center" }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              color:pcolor, fontWeight:600, letterSpacing:1 }}>{p.party}</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#333" }}>
              {p.criminalCases?.length > 0 ? `${p.criminalCases.length}⚖` : ""}
            </span>
          </div>
        </div>

        {/* Score */}
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:800, fontSize:16,
          color, textShadow:`0 0 8px ${color}66`, letterSpacing:-1, minWidth:28, textAlign:"right" }}>
          {p.score.final}
        </div>
      </div>

      {/* Score bar */}
      <div style={{ height:1, background:"#111", marginTop:8, borderRadius:1, overflow:"hidden" }}>
        <div style={{ width:`${p.score.final}%`, height:"100%", background:color, borderRadius:1,
          opacity: selected ? 1 : 0.4 }}/>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  useFonts();
  const [selId,  setSelId]  = useState(initialData[0]?.id);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [tab,    setTab]    = useState("brief");
  const [ticker, setTicker] = useState(0);

  // Ticker
  useEffect(() => { const t = setInterval(() => setTicker(n => n+1), 40); return () => clearInterval(t); }, []);

  const sorted = useMemo(() => {
    const arr = [...initialData];
    if (sortBy === "score")  return arr.sort((a,b) => b.score.final - a.score.final);
    if (sortBy === "assets") return arr.sort((a,b) => (Object.values(b.totalAssets||{}).pop()||0)-(Object.values(a.totalAssets||{}).pop()||0));
    if (sortBy === "cases")  return arr.sort((a,b) => (b.criminalCases?.length||0)-(a.criminalCases?.length||0));
    return arr.sort((a,b) => a.name.localeCompare(b.name));
  }, [initialData, sortBy]);

  const filtered = useMemo(() =>
    sorted.filter(p => `${p.name} ${p.party} ${p.state} ${p.constituency}`.toLowerCase().includes(search.toLowerCase()))
  , [sorted, search]);

  const sel    = initialData.find(p => p.id === selId) || initialData[0];
  const S      = sel.score;
  const color  = TIER_COLOR[S.tier];
  const pcolor = pColor(sel.party);

  const netWorth  = Object.values(sel.totalAssets || {}).pop() || 0;
  const assetYrs  = Object.keys(sel.totalAssets || {}).sort();
  const growth    = assetYrs.length >= 2
    ? ((netWorth - sel.totalAssets[assetYrs[0]]) / (sel.totalAssets[assetYrs[0]] || 1) * 100).toFixed(0)
    : null;

  const DIMS = [
    { key:"wealth",     label:"WEALTH GAP"  },
    { key:"cases",      label:"CASES"        },
    { key:"network",    label:"NETWORK"      },
    { key:"disclosure", label:"DISCLOSURE"   },
    { key:"timing",     label:"TIMING"       },
    { key:"conflict",   label:"CONFLICT"     },
  ];

  // Ticker text
  const tickerText = sorted.slice(0,15).map(p => `${p.name.toUpperCase()} [${p.party}] ▸ ₹${Object.values(p.totalAssets||{}).pop()||0}CR ▸ INDEX:${p.score.final}`).join("   ///   ");
  const doubled    = tickerText + "   ///   " + tickerText;
  const tickX      = -(ticker % (tickerText.length * 7.8));

  const totalCases = useMemo(() => initialData.reduce((s,p) => s+(p.criminalCases?.length||0),0), [initialData]);
  const critical   = useMemo(() => initialData.filter(p => p.score.tier === "CRITICAL").length, [initialData]);

  const TABS = [["brief","BRIEF"],["evidence","EVIDENCE"],["assets","ASSETS"],["network","NETWORK"],["cases","CASES"],["party","PARTY"]];

  const [imgErr, setImgErr] = useState(false);
  useEffect(() => setImgErr(false), [selId]);
  const photo = proxyPhoto(sel.photo);

  return (
    <div style={{ fontFamily:"'Crimson Pro',serif", background:"#050505", minHeight:"100vh",
      color:"#888", fontSize:14, lineHeight:1.6, overflowX:"hidden" }}>

      <ScanEffect/>

      <style>{`
        @keyframes fadeout { to { opacity:0; pointer-events:none; } }
        @keyframes scandown { from { background-position:0 0; } to { background-position:0 100vh; } }
        @keyframes pulse-red { 0%,100%{box-shadow:0 0 6px #FF1A1A} 50%{box-shadow:0 0 20px #FF1A1A} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slidein { from{opacity:0;transform:translateX(8px)} to{opacity:1;transform:none} }
        @keyframes stamp { 0%{transform:scale(2) rotate(-8deg);opacity:0} 60%{transform:scale(0.95) rotate(-3deg)} 100%{transform:scale(1) rotate(-3deg);opacity:1} }
        ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-track { background:#0A0A0A; }
        ::-webkit-scrollbar-thumb { background:#1E1E1E; }
        * { box-sizing:border-box; margin:0; padding:0; }
        .section-header { font-family:'Bebas Neue',cursive; font-size:11px; letter-spacing:4px;
          color:#222; text-transform:uppercase; margin-bottom:14px; padding-bottom:6px;
          border-bottom:1px solid #111; }
        .tab-btn { background:none; border:none; font-family:'JetBrains Mono',monospace;
          font-size:10px; font-weight:600; letter-spacing:2px; color:#333; cursor:pointer;
          padding:10px 14px; border-bottom:1px solid transparent; transition:all 0.15s; white-space:nowrap; }
        .tab-btn:hover { color:#888; }
        .tab-btn.active { color:#CCC; border-bottom-color:#FF1A1A; }
        .sort-btn { background:none; border:1px solid #1A1A1A; border-radius:2px;
          font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:1px;
          color:#333; cursor:pointer; padding:3px 8px; transition:all 0.1s; }
        .sort-btn.active { background:#FF1A1A; color:#FFF; border-color:#FF1A1A; }
        .sort-btn:hover { border-color:#333; color:#888; }
        .dossier-in { animation:slidein 0.2s ease; }
        .stat-box { background:#0A0A0A; border:1px solid #111; padding:12px; text-align:center; }
        .mono { font-family:'JetBrains Mono',monospace; }
        .bebas { font-family:'Bebas Neue',cursive; }
        a { color:inherit; text-decoration:none; }
      `}</style>

      {/* ── TOPBAR ── */}
      <div style={{ height:42, background:"#000", borderBottom:"1px solid #111", display:"flex",
        alignItems:"center", padding:"0 20px", gap:16, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#FF1A1A",
            animation:"pulse-red 2s infinite" }}/>
          <span className="bebas" style={{ fontSize:18, letterSpacing:3, color:"#FFF" }}>NETA</span>
          <span className="bebas" style={{ fontSize:18, letterSpacing:3, color:"#FF1A1A" }}>WATCH</span>
        </div>
        <div style={{ width:1, height:20, background:"#111" }}/>
        <div className="mono" style={{ fontSize:9, color:"#333", letterSpacing:2 }}>
          INDIA POLITICAL INTELLIGENCE SYSTEM
        </div>
        <div style={{ flex:1, overflow:"hidden", position:"relative" }}>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to right, #000 0%, transparent 60px, transparent calc(100% - 60px), #000 100%)", zIndex:1, pointerEvents:"none" }}/>
          <div className="mono" style={{ position:"absolute", top:"50%", transform:"translateY(-50%)",
            fontSize:9, color:"#222", whiteSpace:"nowrap", left:tickX, letterSpacing:1 }}>{doubled}</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
          <div style={{ display:"flex", gap:5, alignItems:"center", border:"1px solid #FF1A1A22",
            padding:"3px 8px", borderRadius:2 }}>
            <div style={{ width:4, height:4, borderRadius:"50%", background:"#FF1A1A",
              animation:"pulse-red 1s infinite" }}/>
            <span className="mono" style={{ fontSize:8, color:"#FF1A1A44", letterSpacing:2 }}>LIVE</span>
          </div>
          <span className="mono" style={{ fontSize:9, color:"#222" }}>{initialData.length} SUBJECTS</span>
          <span className="mono" style={{ fontSize:9, color:"#FF1A1A44" }}>{totalCases} CASES</span>
          <span className="mono" style={{ fontSize:9, color:"#FF1A1A" }}>{critical} CRITICAL</span>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", height:"calc(100vh - 42px)" }}>

        {/* ── LEFT: SUBJECT STACK ── */}
        <div style={{ background:"#000", borderRight:"1px solid #111",
          display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* Search terminal */}
          <div style={{ padding:"12px 14px", borderBottom:"1px solid #111" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8,
              border:"1px solid #1A1A1A", borderRadius:2, padding:"7px 10px",
              background:"#080808" }}>
              <span className="mono" style={{ fontSize:11, color:"#FF1A1A", flexShrink:0 }}>$</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="SEARCH SUBJECTS..."
                style={{ flex:1, background:"none", border:"none", outline:"none",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#888",
                  letterSpacing:1 }}/>
              {search && <span className="mono" style={{ fontSize:11, color:"#333",
                animation:"blink 1s infinite" }}>▋</span>}
            </div>
          </div>

          {/* Sort controls */}
          <div style={{ padding:"6px 14px 8px", borderBottom:"1px solid #111",
            display:"flex", gap:4, alignItems:"center" }}>
            <span className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2, marginRight:4 }}>SORT</span>
            {[["score","IDX"],["assets","₹"],["cases","⚖"],["name","A–Z"]].map(([k,l]) => (
              <button key={k} className={`sort-btn ${sortBy===k?"active":""}`} onClick={() => setSortBy(k)}>{l}</button>
            ))}
            <span className="mono" style={{ fontSize:8, color:"#222", marginLeft:"auto" }}>
              {filtered.length}/{initialData.length}
            </span>
          </div>

          {/* Subject list */}
          <div style={{ flex:1, overflowY:"auto" }}>
            {filtered.map(p => (
              <SubjectCard key={p.id} p={p} selected={p.id===selId}
                onClick={() => { setSelId(p.id); setTab("brief"); }}/>
            ))}
            {filtered.length === 0 && (
              <div className="mono" style={{ padding:"24px", color:"#222", fontSize:10,
                textAlign:"center", letterSpacing:2 }}>NO MATCH FOUND</div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding:"10px 14px", borderTop:"1px solid #111",
            display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {[["SUBJECTS",initialData.length],["TOTAL CASES",totalCases],
              ["CRITICAL",critical],["FLAGGED",initialData.filter(p=>p.score.final>=40).length]
            ].map(([l,v],i) => (
              <div key={i} className="stat-box">
                <div className="mono" style={{ fontSize:14, fontWeight:800,
                  color:i>=2?"#FF1A1A":"#555" }}>{v}</div>
                <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2, marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: DOSSIER ── */}
        <div key={selId} className="dossier-in" style={{ overflowY:"auto", background:"#050505" }}>

          {/* DOSSIER HEADER */}
          <div style={{ background:"#000", borderBottom:"1px solid #111", padding:"20px 24px" }}>
            <div style={{ display:"flex", gap:20, alignItems:"flex-start" }}>

              {/* Photo — mugshot treatment */}
              <div style={{ flexShrink:0, position:"relative" }}>
                <div style={{ width:90, height:110, background:"#0A0A0A",
                  border:`1px solid #1A1A1A`, overflow:"hidden", position:"relative",
                  filter:"grayscale(100%) contrast(1.15) brightness(0.85)" }}>
                  {photo && !imgErr
                    ? <img src={photo} alt={sel.name} onError={()=>setImgErr(true)}
                        style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"top"}}/>
                    : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
                        justifyContent:"center",flexDirection:"column",gap:4}}>
                        <div className="bebas" style={{fontSize:28,color:"#1E1E1E",letterSpacing:2}}>
                          {sel.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
                        </div>
                        <div className="mono" style={{fontSize:8,color:"#1A1A1A",letterSpacing:1}}>NO PHOTO</div>
                      </div>}
                </div>
                {/* Mugshot number */}
                <div className="mono" style={{ fontSize:8, color:"#222", textAlign:"center",
                  marginTop:4, letterSpacing:1 }}>ID: {sel.id?.toString().padStart(4,"0")}</div>
              </div>

              {/* Identity block */}
              <div style={{ flex:1, minWidth:0 }}>
                <div className="mono" style={{ fontSize:9, color:"#333", letterSpacing:3,
                  textTransform:"uppercase", marginBottom:6 }}>CLASSIFIED · PUBLIC RECORD · ECI</div>
                <div className="bebas" style={{ fontSize:42, color:"#FFF", letterSpacing:2,
                  lineHeight:0.9, marginBottom:8 }}>
                  {sel.name.toUpperCase()}
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                  <span className="mono" style={{ fontSize:10, fontWeight:600, color:pcolor,
                    border:`1px solid ${pcolor}33`, padding:"2px 8px", borderRadius:2,
                    letterSpacing:2 }}>{sel.party}</span>
                  <span className="mono" style={{ fontSize:10, color:"#333",
                    border:"1px solid #111", padding:"2px 8px", borderRadius:2 }}>
                    {sel.chamber === "RS" ? "RAJYA SABHA" : "LOK SABHA"}
                  </span>
                  {sel.criminalCases?.length > 0 && (
                    <span className="mono" style={{ fontSize:10, color:"#FF1A1A",
                      border:"1px solid #FF1A1A33", padding:"2px 8px", borderRadius:2,
                      animation:"pulse-red 2s infinite", letterSpacing:1 }}>
                      {sel.criminalCases.length} PENDING CASES
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize:10, color:"#333", lineHeight:2, letterSpacing:.5 }}>
                  {[sel.constituency, sel.state, sel.role, sel.education && `EDU: ${sel.education}`]
                    .filter(Boolean).join(" · ")}
                </div>
              </div>

              {/* Threat meter */}
              <div style={{ flexShrink:0, padding:"8px 16px", background:"#080808",
                border:`1px solid ${color}22`, borderRadius:4,
                boxShadow:`0 0 30px ${color}11, inset 0 0 20px #00000088` }}>
                <div className="mono" style={{ fontSize:8, color:"#333", letterSpacing:3,
                  textAlign:"center", marginBottom:8 }}>CORRUPTION INDEX</div>
                <ThreatMeter score={S.final} tier={S.tier}/>
              </div>
            </div>

            {/* Sub-scores strip */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6, marginTop:16 }}>
              {DIMS.map(d => {
                const v = S.sub[d.key];
                const c = v>=75?"#FF1A1A":v>=55?"#FF6B00":v>=35?"#FFB800":v>=15?"#4ADE80":"#1A1A1A";
                return (
                  <div key={d.key} style={{ background:"#080808", border:"1px solid #111",
                    padding:"8px 10px", textAlign:"center" }}>
                    <div className="mono" style={{ fontSize:15, fontWeight:800, color:c,
                      textShadow:v>40?`0 0 8px ${c}66`:undefined }}>{v}</div>
                    <div className="mono" style={{ fontSize:7, color:"#333", letterSpacing:2,
                      marginTop:3 }}>{d.label}</div>
                    <div style={{ height:2, background:"#0F0F0F", borderRadius:1, marginTop:5, overflow:"hidden" }}>
                      <div style={{ width:`${v}%`, height:"100%", background:c }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stamp */}
            <div style={{ position:"relative", marginTop:12, minHeight:30 }}>
              <div style={{ position:"absolute", right:4, top:-8,
                fontFamily:"'Bebas Neue',cursive", fontSize:28, letterSpacing:6,
                color:S.final >= 40 ? "#FF1A1A" : "#1A4A1A",
                border:`3px solid ${S.final >= 40 ? "#FF1A1A" : "#1A4A1A"}`,
                padding:"0 10px", opacity:0.7, transform:"rotate(-3deg)",
                animation:"stamp 0.5s ease forwards",
                boxShadow: S.final >= 40 ? "0 0 20px #FF1A1A22, inset 0 0 10px #FF1A1A11" : "none",
              }}>
                {S.final >= 60 ? "FLAGGED" : S.final >= 40 ? "ELEVATED RISK" : S.final >= 20 ? "MONITORING" : "CLEAR"}
              </div>
            </div>
          </div>

          {/* TAB BAR */}
          <div style={{ borderBottom:"1px solid #111", display:"flex", overflow:"auto",
            background:"#000", padding:"0 8px" }}>
            {TABS.map(([k,l]) => (
              <button key={k} className={`tab-btn ${tab===k?"active":""}`}
                onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {/* ── TAB CONTENT ── */}
          <div style={{ padding:"20px 24px" }}>

            {/* BRIEF */}
            {tab==="brief" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div>
                  <div className="section-header">FINANCIAL SUMMARY</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                    {[
                      ["NET WORTH", `₹${netWorth}CR`, color],
                      ["GROWTH", growth ? `+${growth}%` : "SINGLE YEAR", "#4ADE80"],
                      ["DECLARED INCOME", `₹${Object.values(sel.declaredIncome||{}).reduce((a,b)=>a+b,0).toFixed(1)}CR`, "#555"],
                      ["UNEXPLAINED GAP", `₹${Math.max(0,netWorth-4.5).toFixed(1)}CR`,
                        netWorth > 20 ? "#FF1A1A" : "#333"],
                    ].map(([l,v,c],i) => (
                      <div key={i} className="stat-box">
                        <div className="mono" style={{ fontSize:16, fontWeight:800, color:c, letterSpacing:-1 }}>{v}</div>
                        <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2, marginTop:4 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <AssetChart totalAssets={sel.totalAssets} liabilities={sel.liabilities}/>
                </div>

                <div>
                  <div className="section-header">INTELLIGENCE FLAGS</div>
                  {S.final < 20 && (
                    <div style={{ padding:"20px", textAlign:"center", border:"1px solid #0F2A0F",
                      borderRadius:3, background:"#050F05" }}>
                      <div className="mono" style={{ fontSize:10, color:"#1A4A1A", letterSpacing:2 }}>
                        NO FLAGS DETECTED
                      </div>
                      <div className="mono" style={{ fontSize:8, color:"#111", marginTop:6 }}>
                        ABSENCE OF FLAGS ≠ ABSENCE OF CORRUPTION
                      </div>
                    </div>
                  )}
                  {netWorth > 20 && (
                    <div style={{ padding:"10px 12px", marginBottom:8, background:"#0D0000",
                      border:"1px solid #FF1A1A22", borderLeft:"3px solid #FF1A1A" }}>
                      <div className="mono" style={{ fontSize:9, color:"#FF6B00", letterSpacing:2, marginBottom:4 }}>
                        UNEXPLAINED WEALTH
                      </div>
                      <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:13, color:"#888", lineHeight:1.5 }}>
                        Declared ₹{netWorth}Cr on a public servant salary. A 30-year government career
                        yields ~₹4.5Cr maximum. Gap of ₹{(netWorth-4.5).toFixed(1)}Cr requires explanation.
                      </div>
                    </div>
                  )}
                  {sel.criminalCases?.filter(c=>c.status==="PENDING").map((c,i) => (
                    <div key={i} style={{ padding:"10px 12px", marginBottom:8, background:"#0D0000",
                      border:"1px solid #FF1A1A22", borderLeft:"3px solid #FF1A1A" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div className="mono" style={{ fontSize:9, color:"#FF1A1A", letterSpacing:2, marginBottom:4 }}>
                            ● ACTIVE CASE
                          </div>
                          <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:13, color:"#888" }}>{c.case}</div>
                          {c.note && <div className="mono" style={{ fontSize:9, color:"#333", marginTop:4 }}>{c.note}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {sel.network?.filter(n => n.govtContractWon || n.tradeBeforePolicy).map((n,i) => (
                    <div key={i} style={{ padding:"10px 12px", marginBottom:8, background:"#0D0008",
                      border:"1px solid #9B59B622", borderLeft:"3px solid #9B59B6" }}>
                      <div className="mono" style={{ fontSize:9, color:"#9B59B6", letterSpacing:2, marginBottom:4 }}>
                        NETWORK RISK · {n.type.toUpperCase()}
                      </div>
                      <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:13, color:"#888" }}>
                        {n.name}
                        {n.govtContractWon && ` won ₹${n.contractValueCr}Cr govt contract`}
                        {n.tradeBeforePolicy && ` — traded before policy announcement`}
                      </div>
                    </div>
                  ))}

                  {/* Party history */}
                  {sel.partyHistory?.length > 1 && (
                    <div style={{ marginTop:16 }}>
                      <div className="section-header">PARTY HISTORY</div>
                      {sel.partyHistory.map((ph, i) => (
                        <div key={i} style={{ display:"flex", gap:10, marginBottom:8, alignItems:"center" }}>
                          <div style={{ width:3, alignSelf:"stretch", background:pColor(ph.party),
                            borderRadius:2, flexShrink:0 }}/>
                          <div style={{ flex:1, background:"#080808", border:"1px solid #111",
                            padding:"8px 12px" }}>
                            <div className="mono" style={{ fontSize:10, fontWeight:600,
                              color:pColor(ph.party), letterSpacing:2 }}>{ph.party}</div>
                            <div className="mono" style={{ fontSize:9, color:"#333", marginTop:2 }}>
                              {ph.from} – {ph.to === 2024 ? "PRESENT" : ph.to}
                            </div>
                          </div>
                          {i < sel.partyHistory.length-1 && (
                            <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:1 }}>→ SWITCH</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* EVIDENCE CHAIN */}
            {tab==="evidence" && (
              <div>
                <div className="section-header">CHRONOLOGICAL EVIDENCE CHAIN</div>
                <EvidenceChain timeline={sel.timeline}/>
                {!sel.timeline?.length && (
                  <div style={{ marginTop:16, padding:"16px", border:"1px solid #111",
                    borderRadius:3 }}>
                    <div className="mono" style={{ fontSize:9, color:"#333", letterSpacing:2 }}>
                      TIMELINE DATA NOT YET ENRICHED. RUN ENRICHMENT SCRIPT.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ASSETS */}
            {tab==="assets" && (
              <div>
                <div className="section-header">ASSET DECLARATION ANALYSIS</div>
                <div style={{ marginBottom:20 }}>
                  <AssetChart totalAssets={sel.totalAssets} liabilities={sel.liabilities}/>
                </div>
                {sel.holdings?.length > 0 && (<>
                  <div className="section-header" style={{ marginTop:20 }}>INVESTMENT HOLDINGS</div>
                  {sel.holdings.map((h,i) => (
                    <div key={i} style={{ display:"flex", gap:10, alignItems:"center",
                      padding:"10px 12px", marginBottom:4, background:"#080808",
                      border:`1px solid ${h.conflict?"#FF1A1A22":"#111"}`,
                      borderLeft:`3px solid ${h.conflict?"#FF1A1A":"#1A1A1A"}` }}>
                      <div style={{ flex:1 }}>
                        <span className="mono" style={{ fontSize:11, color:h.conflict?"#FF1A1A":"#888",
                          letterSpacing:1 }}>{h.sector.toUpperCase()}</span>
                        {h.conflict && <span className="mono" style={{ fontSize:8, color:"#FF1A1A",
                          marginLeft:8, border:"1px solid #FF1A1A33", padding:"1px 5px" }}>CONFLICT</span>}
                      </div>
                      <div className="mono" style={{ fontSize:13, fontWeight:800,
                        color:h.conflict?"#FF1A1A":"#555" }}>₹{h.value}CR</div>
                    </div>
                  ))}
                </>)}
                {sel.directorships?.length > 0 && (<>
                  <div className="section-header" style={{ marginTop:20 }}>MCA21 DIRECTORSHIPS</div>
                  {sel.directorships.map((d,i) => (
                    <div key={i} style={{ padding:"10px 12px", marginBottom:4, background:"#080808",
                      border:"1px solid #111",
                      borderLeft:`3px solid ${d.formedAfterAppt?"#FF6B00":"#1A1A1A"}` }}>
                      <div className="mono" style={{ fontSize:10, color:"#888" }}>{d.name}</div>
                      <div className="mono" style={{ fontSize:8, color:"#333", marginTop:3 }}>
                        {d.cin} · {d.status} · JOINED {d.dateOfJoining||"—"}
                        {d.formedAfterAppt && <span style={{color:"#FF6B00",marginLeft:8}}>POST-APPOINTMENT</span>}
                      </div>
                    </div>
                  ))}
                </>)}
              </div>
            )}

            {/* NETWORK */}
            {tab==="network" && (
              <div>
                <div className="section-header">NETWORK ANALYSIS</div>
                {(!sel.network?.length) && (
                  <div className="mono" style={{ color:"#222", fontSize:10, letterSpacing:2, padding:"20px 0" }}>
                    NO NETWORK DATA ON FILE
                  </div>
                )}
                {sel.network?.map((n,i) => {
                  const W = { spouse:1.0,child:0.9,sibling:0.7,parent:0.6,associate:0.8,shell_company:1.0 };
                  const prox = W[n.type]||0.5;
                  const risk = Math.round((
                    (n.holdingsInConflictSectors?25:0)+
                    (n.tradeBeforePolicy?35:0)+
                    (n.govtContractWon?30+Math.min(Math.log10(Math.max(n.contractValueCr||1,1))*5,15):0)
                  )*prox);
                  return (
                    <div key={i} style={{ marginBottom:12, padding:"14px 16px", background:"#080808",
                      border:"1px solid #111",
                      borderLeft:`3px solid ${risk>50?"#FF1A1A":risk>25?"#FF6B00":"#1A1A1A"}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div className="mono" style={{ fontSize:12, color:"#CCC", fontWeight:600 }}>{n.name}</div>
                          <div className="mono" style={{ fontSize:9, color:"#333", marginTop:3, letterSpacing:2 }}>
                            {n.type.replace(/_/g," ").toUpperCase()} · PROXIMITY: {Math.round(prox*100)}%
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div className="mono" style={{ fontSize:20, fontWeight:800,
                            color:risk>50?"#FF1A1A":risk>25?"#FF6B00":"#555" }}>{risk}</div>
                          <div className="mono" style={{ fontSize:7, color:"#333", letterSpacing:2 }}>RISK PTS</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                        {n.holdingsInConflictSectors && <span className="mono" style={{fontSize:8,color:"#FF6B00",
                          border:"1px solid #FF6B0033",padding:"2px 6px"}}>CONFLICT HOLDINGS</span>}
                        {n.tradeBeforePolicy && <span className="mono" style={{fontSize:8,color:"#FF1A1A",
                          border:"1px solid #FF1A1A33",padding:"2px 6px"}}>INSIDER TRADE</span>}
                        {n.govtContractWon && <span className="mono" style={{fontSize:8,color:"#FFB800",
                          border:"1px solid #FFB80033",padding:"2px 6px"}}>
                          GOVT CONTRACT ₹{n.contractValueCr}CR</span>}
                      </div>
                      {n.note && <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:12,
                        color:"#444", marginTop:8, fontStyle:"italic" }}>{n.note}</div>}
                    </div>
                  );
                })}

                {sel.electoralBonds && (
                  <div style={{ marginTop:20 }}>
                    <div className="section-header">ELECTORAL BOND EXPOSURE</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                      <div className="stat-box">
                        <div className="mono" style={{ fontSize:18, fontWeight:800,
                          color:"#FF6B00" }}>₹{sel.electoralBonds.partyReceivedCr?.toFixed(0)||0}CR</div>
                        <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2 }}>PARTY RECEIVED</div>
                      </div>
                      <div className="stat-box" style={{borderColor:sel.electoralBonds.suspiciousDonors?.length?"#FF1A1A22":"#111"}}>
                        <div className="mono" style={{ fontSize:18, fontWeight:800,
                          color:sel.electoralBonds.suspiciousDonors?.length?"#FF1A1A":"#555" }}>
                          {sel.electoralBonds.suspiciousDonors?.length||0}
                        </div>
                        <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2 }}>FLAGGED DONORS</div>
                      </div>
                    </div>
                    {sel.electoralBonds.topDonors?.map((d,i) => {
                      const flagged = sel.electoralBonds.suspiciousDonors?.some(s=>s.name===d.name);
                      return (
                        <div key={i} style={{ padding:"8px 12px", marginBottom:4, background:"#080808",
                          border:`1px solid ${flagged?"#FF1A1A22":"#111"}`,
                          borderLeft:`3px solid ${flagged?"#FF1A1A":"#1A1A1A"}` }}>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span className="mono" style={{ fontSize:10, color:flagged?"#FF1A1A":"#888" }}>
                              {d.name}
                            </span>
                            <span className="mono" style={{ fontSize:10, fontWeight:800,
                              color:flagged?"#FF1A1A":"#555" }}>₹{d.amountCr}CR</span>
                          </div>
                          {flagged && <div className="mono" style={{ fontSize:8, color:"#FF1A1A44",
                            marginTop:3, letterSpacing:2 }}>COMPANY UNDER ED/REGULATORY SCRUTINY</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* CASES */}
            {tab==="cases" && (
              <div>
                <div className="section-header">CRIMINAL CASE REGISTER</div>
                {(!sel.criminalCases?.length) && (
                  <div style={{ padding:"20px", textAlign:"center", border:"1px solid #0F2A0F",
                    background:"#050F05" }}>
                    <div className="mono" style={{ fontSize:10, color:"#1A4A1A", letterSpacing:3 }}>
                      NO CRIMINAL CASES ON RECORD
                    </div>
                  </div>
                )}
                {sel.criminalCases?.map((c,i) => {
                  const statusColor = c.status==="PENDING"?"#FF1A1A":c.status==="DROPPED"?"#FF6B00":"#4ADE80";
                  return (
                    <div key={i} style={{ marginBottom:10, padding:"14px 16px", background:"#080808",
                      border:`1px solid ${statusColor}22`,
                      borderLeft:`3px solid ${statusColor}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <div className="mono" style={{ fontSize:10, color:statusColor,
                          display:"flex", alignItems:"center", gap:6 }}>
                          {c.status==="PENDING" && <span style={{animation:"pulse-red 1s infinite"}}>●</span>}
                          {c.status}
                        </div>
                        {c.resolvedYear && <div className="mono" style={{ fontSize:9, color:"#333" }}>
                          RESOLVED {c.resolvedYear}
                        </div>}
                      </div>
                      <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:15, color:"#CCC",
                        fontWeight:600, marginBottom:6 }}>{c.case}</div>
                      {c.note && <div className="mono" style={{ fontSize:9, color:"#444",
                        borderTop:"1px solid #111", paddingTop:6, letterSpacing:.5 }}>
                        NOTE: {c.note}
                      </div>}
                    </div>
                  );
                })}
                <div style={{ marginTop:16, padding:"10px 12px", border:"1px solid #111",
                  display:"flex", gap:10, alignItems:"center" }}>
                  <span className="mono" style={{ fontSize:9, color:"#333" }}>VERIFY ON:</span>
                  <a href="https://njdg.ecourts.gov.in" target="_blank" rel="noreferrer"
                    className="mono" style={{ fontSize:9, color:"#FF1A1A44",
                    border:"1px solid #FF1A1A22", padding:"2px 8px" }}>
                    NJDG COURTS →
                  </a>
                </div>
              </div>
            )}

            {/* PARTY */}
            {tab==="party" && (
              <div>
                <div className="section-header">PARTY AFFILIATION ANALYSIS</div>
                <div style={{ marginBottom:20 }}>
                  {sel.partyHistory?.map((ph,i) => {
                    const c  = pColor(ph.party);
                    const assets = Object.values(sel.totalAssets||{})[i]||0;
                    return (
                      <div key={i} style={{ marginBottom:8, padding:"14px 16px", background:"#080808",
                        border:"1px solid #111",
                        borderLeft:`3px solid ${c}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div className="mono" style={{ fontSize:14, fontWeight:600,
                              color:c, letterSpacing:2 }}>{ph.party}</div>
                            <div className="mono" style={{ fontSize:9, color:"#333", marginTop:4 }}>
                              {ph.from} — {ph.to===2024?"PRESENT":ph.to}
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div className="mono" style={{ fontSize:20, fontWeight:800,
                              color:"#555" }}>₹{assets}CR</div>
                            <div className="mono" style={{ fontSize:8, color:"#222", letterSpacing:2 }}>
                              DECLARED ASSETS
                            </div>
                          </div>
                        </div>
                        {/* Check if any case dropped in this period */}
                        {sel.criminalCases?.filter(c=>c.status==="DROPPED"&&c.resolvedYear>=ph.from&&c.resolvedYear<=ph.to).map((c,j) => (
                          <div key={j} className="mono" style={{ fontSize:9, color:"#FF6B00",
                            marginTop:8, borderTop:"1px solid #111", paddingTop:6 }}>
                            ▲ CASE DROPPED DURING THIS TENURE: {c.case}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {/* Party-wide stats */}
                <div className="section-header" style={{ marginTop:20 }}>PARTY-WIDE STATISTICS</div>
                {(() => {
                  const partyMap = {};
                  initialData.forEach(p => {
                    const party = p.party;
                    if (!partyMap[party]) partyMap[party] = {count:0,cases:0,totalAssets:0,score:0};
                    partyMap[party].count++;
                    partyMap[party].cases += (p.criminalCases?.length||0);
                    partyMap[party].totalAssets += (Object.values(p.totalAssets||{}).pop()||0);
                    partyMap[party].score += p.score.final;
                  });
                  return Object.entries(partyMap)
                    .sort((a,b)=>b[1].cases-a[1].cases).slice(0,8)
                    .map(([party,s],i) => {
                      const c = pColor(party);
                      const avgScore = Math.round(s.score/s.count);
                      return (
                        <div key={i} style={{ display:"flex", gap:10, alignItems:"center",
                          padding:"10px 12px", marginBottom:4, background:"#080808",
                          border:"1px solid #111", borderLeft:`3px solid ${c}` }}>
                          <div className="mono" style={{ fontSize:11, fontWeight:600, color:c,
                            letterSpacing:2, width:80, flexShrink:0 }}>{party}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ height:3, background:"#111", overflow:"hidden", borderRadius:1 }}>
                              <div style={{ width:`${Math.min((s.cases/totalCases)*100*3,100)}%`,
                                height:"100%", background:c }}/>
                            </div>
                          </div>
                          <div className="mono" style={{ fontSize:10, color:"#FF1A1A", width:40,
                            textAlign:"right", flexShrink:0 }}>{s.cases}</div>
                          <div className="mono" style={{ fontSize:9, color:"#333", width:50,
                            textAlign:"right", flexShrink:0 }}>AVG:{avgScore}</div>
                        </div>
                      );
                    });
                })()}
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop:32, paddingTop:16, borderTop:"1px solid #111",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div className="mono" style={{ fontSize:8, color:"#1A1A1A", letterSpacing:2 }}>
                DATA: ECI · MCA21 · NJDG · SANSAD.IN · SBI ELECTORAL BONDS
              </div>
              <div className="mono" style={{ fontSize:8, color:"#1A1A1A", letterSpacing:2 }}>
                PUBLIC INTEREST TRANSPARENCY PROJECT · ALL DATA IS PUBLIC RECORD
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
