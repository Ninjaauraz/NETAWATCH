"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, RadarChart,
  Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import { WEIGHTS } from "../lib/scoring";

const C = {
  bg:"#F4F4F4", card:"#FFFFFF", ink:"#111111", dim:"#555555",
  muted:"#999999", border:"#E8E8E8",
  red:"#D0021B",    redBg:"#FFF0F1",
  orange:"#C45000", orangeBg:"#FFF4EE",
  green:"#1A7A3C",  greenBg:"#F0FAF3",
  blue:"#1A56A0",   blueBg:"#EFF4FF",
};
const PARTY_C = {
  BJP:{ fg:"#E8450A", bg:"#FFF1EC" }, INC:{ fg:"#1155AA", bg:"#EEF4FF" },
  NCP:{ fg:"#6B21A8", bg:"#F5F0FF" }, AAP:{ fg:"#007A82", bg:"#EDFAFA" },
  TMC:{ fg:"#00695C", bg:"#E0F2F1" }, AITC:{ fg:"#00695C", bg:"#E0F2F1" },
  SP: { fg:"#D84315", bg:"#FBE9E7" }, BSP:{ fg:"#1565C0", bg:"#E3F2FD" },
  DMK:{ fg:"#C62828", bg:"#FFEBEE" }, JDU:{ fg:"#00838F", bg:"#E0F7FA" },
  RJD:{ fg:"#AD1457", bg:"#FCE4EC" }, IND:{ fg:"#455A64", bg:"#ECEFF1" },
};
const TL_C = { party:"#6B21A8", legal:C.red, appt:C.orange, trade:C.blue, policy:"#444", gain:C.green };
const DIMS = [
  { key:"incomeGap",      label:"Income Gap",   desc:"Wealth vs public salary baseline"    },
  { key:"sectorConflict", label:"Conflict",      desc:"Holdings in regulated sectors"       },
  { key:"tradeTiming",    label:"Timing",        desc:"Trades near policy events"           },
  { key:"caseDisposal",   label:"Cases",         desc:"Criminal cases — count & disposal"   },
  { key:"networkRisk",    label:"Network",       desc:"Family & associate activity"         },
  { key:"disclosure",     label:"Disclosure",    desc:"Late or amended declarations"        },
];

const sc = v => v>=80?C.red:v>=60?C.orange:v>=30?"#B08000":C.green;
const pc = p => PARTY_C[p?.toUpperCase()] || PARTY_C.IND;

function proxyPhoto(url) {
  if (!url) return "";
  if (url.includes("weserv.nl")) return url;
  if (url.includes("wikimedia") || url.includes("wikipedia")) {
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=120&h=120&fit=cover&mask=circle`;
  }
  return url;
}

// ── Small components ──────────────────────────────────────────────────────────
const Ring = ({ score, size=56 }) => {
  const r=size/2-5, circ=2*Math.PI*r, color=sc(score);
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={4}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        style={{fontSize:size*.22,fontWeight:800,fill:color,fontFamily:"inherit"}}>{score}</text>
    </svg>
  );
};

const MiniBar = ({ v, color, h=4 }) => (
  <div style={{background:C.border,borderRadius:3,height:h,overflow:"hidden"}}>
    <div style={{width:`${Math.min(v,100)}%`,height:"100%",background:color,borderRadius:3,transition:"width .5s ease"}}/>
  </div>
);

const Badge = ({ label, color, bg }) => (
  <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:700,
    padding:"2px 8px",borderRadius:3,background:bg||"transparent",
    color:color||C.dim,border:`1px solid ${(color||C.dim)+"22"}`}}>{label}</span>
);

const Sec = ({ children, action }) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
    <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>{children}</div>
    {action}
  </div>
);

const TT = ({ active, payload, label }) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,padding:"8px 12px",fontSize:11,boxShadow:"0 2px 8px rgba(0,0,0,.08)"}}>
      <div style={{color:C.muted,marginBottom:4}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color,fontWeight:600}}>{p.name}: ₹{p.value}Cr</div>)}
    </div>
  );
};

function Avatar({ politician, size=40 }) {
  const [err, setErr] = useState(false);
  const ppc  = pc(politician.party);
  const photo = proxyPhoto(politician.photo);
  if (photo && !err) {
    return <img src={photo} alt={politician.name} onError={()=>setErr(true)}
      style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",
        border:`2px solid ${ppc.fg}`,flexShrink:0,background:ppc.bg}}/>;
  }
  return (
    <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,
      background:ppc.bg,border:`2px solid ${ppc.fg}`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:size*.28,fontWeight:800,color:ppc.fg}}>
      {politician.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
    </div>
  );
}

const StatCard = ({ label, value, color, sub }) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,
    padding:"12px 10px",textAlign:"center",borderTop:`3px solid ${color||C.border}`}}>
    <div style={{fontSize:18,fontWeight:800,color:color||C.ink,lineHeight:1}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:C.green,fontWeight:600,marginTop:2}}>{sub}</div>}
    <div style={{fontSize:9,color:C.muted,marginTop:4,textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
  </div>
);

// ── Live Ticker ───────────────────────────────────────────────────────────────
function Ticker({ politicians }) {
  const [offset, setOffset] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>setOffset(o=>o+1), 35);
    return ()=>clearInterval(t);
  },[]);
  const items = politicians.slice(0,20);
  const text  = items.map(p=>`${p.name} (${p.party}) ▸ ₹${Object.values(p.totalAssets||{}).pop()||0}Cr ▸ Score: ${p.scoring?.final||0} ▸ Cases: ${p.criminalCases?.length||0}`).join("   ·   ");
  const doubled = text + "   ·   " + text;
  const charW = 7.5, totalW = text.length * charW, x = -(offset % totalW);
  return (
    <div style={{background:"#0a0a0a",height:26,overflow:"hidden",borderBottom:`1px solid #1a1a1a`,position:"relative"}}>
      <div style={{display:"flex",alignItems:"center",height:"100%",gap:10,padding:"0 10px"}}>
        <span style={{color:"#22C55E",fontSize:9,fontWeight:800,letterSpacing:2,flexShrink:0}}>LIVE</span>
        <div style={{overflow:"hidden",flex:1,position:"relative",height:"100%"}}>
          <div style={{position:"absolute",top:"50%",transform:"translateY(-50%)",
            whiteSpace:"nowrap",fontSize:11,color:"#888",left:x,fontFamily:"monospace"}}>
            {doubled}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live Enrichment Panel ─────────────────────────────────────────────────────
function LivePanel({ politician }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    if (fetched) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ name: politician.name, constituency: politician.constituency || "" });
      const res    = await fetch(`/api/enrich/${politician.id}?${params}`);
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
    setFetched(true);
  }, [politician.id, politician.name, fetched]);

  useEffect(() => { setData(null); setFetched(false); }, [politician.id]);

  return (
    <div className="card">
      <Sec action={
        !fetched && (
          <button onClick={load} disabled={loading}
            style={{background:C.ink,color:"#fff",border:"none",borderRadius:4,
              padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer",
              opacity:loading?0.6:1,fontFamily:"inherit"}}>
            {loading ? "Loading…" : "● Fetch Live Data"}
          </button>
        )
      }>
        Live Intelligence
      </Sec>

      {!fetched && !loading && (
        <div style={{padding:"16px 0",textAlign:"center",color:C.muted,fontSize:12}}>
          <div style={{fontSize:24,marginBottom:8}}>📡</div>
          Click "Fetch Live Data" to pull real-time court activity, parliamentary records, and news for {politician.name}.
        </div>
      )}

      {loading && (
        <div style={{padding:"16px 0",textAlign:"center",color:C.muted,fontSize:12}}>
          <div style={{fontSize:24,marginBottom:8,animation:"pulse 1s infinite"}}>🔄</div>
          Fetching court records, parliamentary data, news…
        </div>
      )}

      {fetched && data && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>

          {/* Last updated */}
          <div style={{fontSize:10,color:C.muted,textAlign:"right"}}>
            Updated: {new Date(data.lastUpdated).toLocaleString("en-IN")}
          </div>

          {/* Parliamentary activity */}
          <div style={{background:C.bg,borderRadius:6,padding:"12px 14px"}}>
            <div style={{fontSize:11,fontWeight:700,marginBottom:8,display:"flex",gap:6,alignItems:"center"}}>
              🏛️ Parliamentary Activity
            </div>
            {data.parliament ? (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Questions Asked",    data.parliament.questionsAsked    ?? "—"],
                  ["Debates",            data.parliament.debatesParticipated ?? "—"],
                  ["Attendance",         data.parliament.attendancePct ? `${data.parliament.attendancePct}%` : "—"],
                  ["Member Since",       data.parliament.memberSince       ?? "—"],
                ].map(([l,v],i)=>(
                  <div key={i} style={{background:C.card,borderRadius:4,padding:"8px 10px"}}>
                    <div style={{fontSize:14,fontWeight:800,color:C.ink}}>{v}</div>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{fontSize:12,color:C.muted}}>
                Parliamentary data not available. 
                <a href={`https://sansad.in/ls/members`} target="_blank" rel="noreferrer"
                  style={{color:C.blue,marginLeft:4}}>Check Sansad.in →</a>
              </div>
            )}
          </div>

          {/* Court activity from news */}
          {data.courtStatus && data.courtStatus.length > 0 && (
            <div style={{background:C.redBg,borderRadius:6,padding:"12px 14px",border:`1px solid ${C.red}22`}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8,color:C.red}}>
                ⚖️ Recent Court Activity (via news)
              </div>
              {data.courtStatus.map((item,i)=>(
                <div key={i} style={{fontSize:12,color:C.ink,marginBottom:6,paddingBottom:6,
                  borderBottom:i<data.courtStatus.length-1?`1px solid ${C.border}`:"none"}}>
                  <div>{item.title}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>{item.pubDate}</div>
                </div>
              ))}
            </div>
          )}

          {/* News */}
          {data.news && data.news.length > 0 && (
            <div style={{background:C.bg,borderRadius:6,padding:"12px 14px"}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>📰 Recent News</div>
              {data.news.map((item,i)=>(
                <div key={i} style={{marginBottom:8,paddingBottom:8,
                  borderBottom:i<data.news.length-1?`1px solid ${C.border}`:"none"}}>
                  <a href={item.link} target="_blank" rel="noreferrer"
                    style={{fontSize:12,color:C.ink,textDecoration:"none",fontWeight:500,lineHeight:1.5,
                      display:"block","&:hover":{color:C.blue}}}>
                    {item.title}
                  </a>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>
                    {item.source} · {item.pubDate}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.news?.length === 0 && !data.courtStatus && !data.parliament && (
            <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"12px 0"}}>
              No live data found for {politician.name}. Try searching directly on{" "}
              <a href={`https://njdg.ecourts.gov.in`} target="_blank" rel="noreferrer" style={{color:C.blue}}>NJDG</a>
              {" "}or{" "}
              <a href={`https://sansad.in`} target="_blank" rel="noreferrer" style={{color:C.blue}}>Sansad.in</a>.
            </div>
          )}
        </div>
      )}

      {/* Always show direct links */}
      <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,
        display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:C.muted,fontWeight:700}}>Check directly:</span>
        {[
          ["NJDG Court Records", `https://njdg.ecourts.gov.in/njdgnew/index.php`],
          ["Sansad.in",          `https://sansad.in/ls/members`],
          ["ECI Affidavit",      `https://www.myneta.info/LokSabha2024/`],
          ["MyNeta Profile",     `https://www.myneta.info/LokSabha2024/`],
        ].map(([label,url],i)=>(
          <a key={i} href={url} target="_blank" rel="noreferrer"
            style={{fontSize:10,color:C.blue,fontWeight:600,
              padding:"3px 8px",border:`1px solid ${C.blue}22`,borderRadius:3,
              textDecoration:"none",background:C.blueBg}}>
            {label} →
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  const [selId,  setSelId]  = useState(initialData[0]?.id);
  const [tab,    setTab]    = useState("overview");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [clock,  setClock]  = useState("");

  useEffect(()=>{
    const tick=()=>setClock(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}));
    tick();
    const t=setInterval(tick,30000);
    return ()=>clearInterval(t);
  },[]);

  const sorted = useMemo(()=>{
    const arr=[...initialData];
    if(sortBy==="score")  return arr.sort((a,b)=>b.scoring.final-a.scoring.final);
    if(sortBy==="assets") return arr.sort((a,b)=>(Object.values(b.totalAssets||{}).pop()||0)-(Object.values(a.totalAssets||{}).pop()||0));
    if(sortBy==="cases")  return arr.sort((a,b)=>(b.criminalCases?.length||0)-(a.criminalCases?.length||0));
    if(sortBy==="name")   return arr.sort((a,b)=>a.name.localeCompare(b.name));
    return arr;
  },[initialData,sortBy]);

  const filtered = useMemo(()=>
    sorted.filter(p=>`${p.name} ${p.party} ${p.state} ${p.constituency}`.toLowerCase().includes(search.toLowerCase()))
  ,[sorted,search]);

  const sel = initialData.find(p=>p.id===selId)||initialData[0];
  const scr = sel.scoring;
  const ppc = pc(sel.party);

  const assetYears   = Object.keys(sel.totalAssets||{}).sort();
  const assetData    = assetYears.map(y=>({y,assets:sel.totalAssets[y],liab:sel.liabilities?.[y]||0}));
  const latestYear   = assetYears[assetYears.length-1]||"2024";
  const earliestYear = assetYears[0]||"2024";
  const netWorth     = sel.totalAssets[latestYear]||0;
  const growthAbs    = (netWorth-(sel.totalAssets[earliestYear]||0)).toFixed(1);
  const growthPct    = assetYears.length>=2
    ? (((netWorth-sel.totalAssets[earliestYear])/sel.totalAssets[earliestYear])*100).toFixed(0) : null;
  const totalDeclared = Object.values(sel.declaredIncome||{}).reduce((a,b)=>a+b,0).toFixed(2);
  const gap           = Math.max(0,netWorth-parseFloat(totalDeclared)).toFixed(1);

  const totalCases = useMemo(()=>initialData.reduce((s,p)=>s+(p.criminalCases?.length||0),0),[initialData]);
  const highRisk   = useMemo(()=>initialData.filter(p=>p.scoring.final>=50).length,[initialData]);
  const partyStats = useMemo(()=>{
    const map={};
    initialData.forEach(p=>{
      if(!map[p.party]) map[p.party]={count:0,totalScore:0,totalCases:0};
      map[p.party].count++;
      map[p.party].totalScore+=p.scoring.final;
      map[p.party].totalCases+=(p.criminalCases?.length||0);
    });
    return Object.entries(map)
      .map(([party,s])=>({party,count:s.count,avgScore:Math.round(s.totalScore/s.count),totalCases:s.totalCases}))
      .sort((a,b)=>b.totalCases-a.totalCases).slice(0,10);
  },[initialData]);

  // Radar data for score breakdown
  const radarData = DIMS.map(d=>({
    dimension: d.label,
    score:     scr.subScores[d.key],
    fullMark:  100,
  }));

  const TABS=[["overview","Overview"],["live","● Live"],["scoring","Score"],["network","Network"],["cases","Cases"],["party","Party"],["timeline","Timeline"]];

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",background:C.bg,minHeight:"100vh",color:C.ink,fontSize:13,lineHeight:1.5}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}::-webkit-scrollbar-thumb{background:#DDD;border-radius:2px;}
        .tab{background:none;border:none;border-bottom:2px solid transparent;color:${C.muted};
          padding:9px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s;}
        .tab.on{color:${C.ink};border-bottom-color:${C.ink};}.tab:hover{color:${C.ink};}
        .tab.live{color:#22C55E;}.tab.live.on{border-bottom-color:#22C55E;}
        .prow{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;
          border-bottom:1px solid ${C.border};border-left:3px solid transparent;transition:background .1s;}
        .prow:hover{background:#F9F9F9;}.prow.on{background:${C.card};border-left-color:${C.red};}
        .card{background:${C.card};border:1px solid ${C.border};border-radius:6px;padding:14px 16px;}
        .flag{display:flex;gap:10px;padding:10px 12px;margin-bottom:5px;background:${C.redBg};
          border-left:3px solid ${C.red};border-radius:0 4px 4px 0;font-size:12px;line-height:1.6;}
        .search{width:100%;background:${C.bg};border:1px solid ${C.border};border-radius:4px;
          padding:8px 10px;font-size:12px;font-family:inherit;outline:none;color:${C.ink};}
        .search:focus{border-color:${C.ink};}.search::placeholder{color:${C.muted};}
        .srt{background:none;border:1px solid ${C.border};border-radius:3px;padding:3px 8px;
          font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;color:${C.dim};transition:all .1s;}
        .srt.on{background:${C.ink};color:#fff;border-color:${C.ink};}
        @media(min-width:768px){
          .layout{display:grid;grid-template-columns:290px 1fr;min-height:calc(100vh - 74px);}
          .sidebar{border-right:1px solid ${C.border};position:sticky;top:74px;
            height:calc(100vh - 74px);overflow-y:auto;display:flex;flex-direction:column;}}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
        .g5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
        @media(max-width:767px){.g2{grid-template-columns:1fr!important;}.g5{grid-template-columns:repeat(3,1fr)!important;}}
        @media(max-width:480px){.g3{grid-template-columns:1fr 1fr;}.g5{grid-template-columns:1fr 1fr!important;}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadein{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
        .fadein{animation:fadein .18s ease;}
      `}</style>

      {/* NAV */}
      <nav style={{background:C.ink,height:48,display:"flex",alignItems:"center",
        justifyContent:"space-between",padding:"0 16px",position:"sticky",top:0,zIndex:200}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.red,animation:"pulse 2s infinite"}}/>
          <span style={{color:"#fff",fontSize:16,fontWeight:800,letterSpacing:-.3}}>
            Neta<span style={{color:"#FF6B6B"}}>Watch</span>
          </span>
          <span style={{color:"#444",fontSize:10,marginLeft:4,letterSpacing:1}}>INDIA · PUBLIC DATA</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",gap:5,alignItems:"center",background:"#1a1a1a",padding:"3px 9px",borderRadius:3}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:"#22C55E",animation:"pulse 1.5s infinite"}}/>
            <span style={{fontSize:9,color:"#22C55E",letterSpacing:1,fontWeight:700}}>LIVE SCORES</span>
          </div>
          <span style={{fontSize:10,color:"#888"}}>{initialData.length} MPs</span>
          <span style={{fontSize:10,color:"#555"}}>{clock}</span>
        </div>
      </nav>
      <Ticker politicians={sorted}/>

      <div className="layout">
        {/* SIDEBAR */}
        <aside className="sidebar" style={{background:C.card}}>
          <div style={{padding:"10px 12px 6px",borderBottom:`1px solid ${C.border}`}}>
            <input className="search" placeholder="Search name, party, state…"
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{padding:"6px 12px 8px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginRight:2}}>Sort:</span>
            {[["score","Score"],["assets","Wealth"],["cases","Cases"],["name","A–Z"]].map(([k,l])=>(
              <button key={k} className={`srt ${sortBy===k?"on":""}`} onClick={()=>setSortBy(k)}>{l}</button>
            ))}
          </div>
          <div style={{padding:"6px 14px 4px",fontSize:10,color:C.muted,fontWeight:600,letterSpacing:1,textTransform:"uppercase"}}>
            {filtered.length} / {initialData.length} politicians
          </div>

          {filtered.map(p=>{
            const ppc2=pc(p.party);
            return (
              <div key={p.id} className={`prow ${selId===p.id?"on":""}`}
                onClick={()=>{setSelId(p.id);setTab("overview");}}>
                <Avatar politician={p} size={38}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <span style={{color:ppc2.fg,fontWeight:700}}>{p.party}</span>{" · "}{p.state||p.constituency}
                  </div>
                  <MiniBar v={p.scoring.final} color={sc(p.scoring.final)} h={3}/>
                </div>
                <Ring score={p.scoring.final} size={40}/>
              </div>
            );
          })}
          {filtered.length===0&&<div style={{padding:"24px 16px",textAlign:"center",color:C.muted,fontSize:12}}>No results</div>}

          <div style={{marginTop:"auto",padding:"12px 14px",borderTop:`1px solid ${C.border}`}}>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:1,textAlign:"center",background:C.redBg,borderRadius:5,padding:"8px 4px"}}>
                <div style={{fontSize:18,fontWeight:800,color:C.red}}>{totalCases}</div>
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Total Cases</div>
              </div>
              <div style={{flex:1,textAlign:"center",background:C.orangeBg,borderRadius:5,padding:"8px 4px"}}>
                <div style={{fontSize:18,fontWeight:800,color:C.orange}}>{highRisk}</div>
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Moderate+</div>
              </div>
            </div>
            <p style={{fontSize:10,color:C.muted,lineHeight:1.7}}>Source: ECI affidavits · Sansad.in · NJDG<br/>All data is public record.</p>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{overflowY:"auto",background:C.bg}}>
          {/* HERO */}
          <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"16px 16px 0"}} className="fadein">
            <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:14}}>
              <Avatar politician={sel} size={72}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:4,fontWeight:600}}>ECI Affidavit · Public Record</div>
                <h1 style={{fontSize:20,fontWeight:800,letterSpacing:-.3,marginBottom:6}}>{sel.name}</h1>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
                  <Badge label={sel.party} color={ppc.fg} bg={ppc.bg}/>
                  {sel.partyFull && sel.partyFull !== sel.party &&
                    <span style={{fontSize:11,color:C.dim}}>{sel.partyFull}</span>}
                  <span style={{fontSize:11,color:C.dim}}>{sel.role||`MP · ${sel.constituency}`}</span>
                </div>
                <div style={{fontSize:11,color:C.dim}}>
                  {[sel.constituency,sel.state,sel.education,sel.age?`Age ${sel.age}`:null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{textAlign:"center",flexShrink:0}}>
                <Ring score={scr.final} size={64}/>
                <div style={{fontSize:9,fontWeight:700,letterSpacing:1,marginTop:3,color:sc(scr.final)}}>{scr.riskLevel}</div>
                <div style={{fontSize:8,color:C.muted,marginTop:1}}>SUSPICION</div>
              </div>
            </div>

            {/* Stats */}
            <div className="g5" style={{marginBottom:12}}>
              <StatCard label="Net Worth"        value={`₹${netWorth}Cr`}/>
              <StatCard label={growthPct?`Growth ${earliestYear}–${latestYear}`:"Declared 2024"}
                value={growthPct?`+${growthPct}%`:`₹${netWorth}Cr`}
                sub={growthPct&&parseFloat(growthAbs)>0?`+₹${growthAbs}Cr`:undefined} color={C.green}/>
              <StatCard label="Wealth vs Salary" value={`₹${gap}Cr`}
                color={parseFloat(gap)>50?C.red:parseFloat(gap)>10?C.orange:C.green}/>
              <StatCard label="Criminal Cases"   value={sel.criminalCases?.length||0}
                color={(sel.criminalCases?.length||0)>0?C.red:C.green}/>
              <StatCard label="Party Switches"   value={sel.partyHistory.length-1}
                color={sel.partyHistory.length>2?"#6B21A8":C.dim}/>
            </div>

            {/* Flags */}
            {scr.flags.length>0&&(
              <div style={{marginBottom:12}}>
                {scr.flags.map((f,i)=>(
                  <div key={i} className="flag">
                    <span style={{color:C.red,fontWeight:800,flexShrink:0}}>⚠</span>{f}
                  </div>
                ))}
              </div>
            )}

            {/* Sub-scores */}
            <div className="g3" style={{marginBottom:12}}>
              {DIMS.map((d,i)=>{
                const v=scr.subScores[d.key];
                return (
                  <div key={i} style={{background:C.bg,borderRadius:5,padding:"8px 10px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:10,color:C.dim,fontWeight:600}}>{d.label}</span>
                      <span style={{fontSize:11,fontWeight:800,color:sc(v)}}>{v}</span>
                    </div>
                    <MiniBar v={v} color={sc(v)} h={4}/>
                  </div>
                );
              })}
            </div>

            {/* Tabs */}
            <div style={{display:"flex",overflowX:"auto",borderTop:`1px solid ${C.border}`,margin:"0 -16px",paddingLeft:4}}>
              {TABS.map(([k,l])=>(
                <button key={k} className={`tab ${tab===k?"on":""} ${k==="live"?"live":""}`}
                  onClick={()=>setTab(k)}>{l}</button>
              ))}
            </div>
          </div>

          {/* TAB CONTENT */}
          <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>

            {/* OVERVIEW */}
            {tab==="overview"&&(<>
              <div className="g2">
                {/* Wealth chart */}
                <div className="card">
                  <Sec>Declared Wealth (₹ Cr)</Sec>
                  {assetData.length>=2?(
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={assetData}>
                        <defs>
                          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.blue} stopOpacity={0.15}/>
                            <stop offset="100%" stopColor={C.blue} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="y" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
                        <Tooltip content={<TT/>}/>
                        <Area dataKey="assets" name="Assets" stroke={C.blue} strokeWidth={2} fill="url(#ag)"/>
                        <Area dataKey="liab" name="Liabilities" stroke={C.red} strokeWidth={1.5} fill="none" strokeDasharray="4 2"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  ):(
                    // Single year — show a horizontal bar comparing to avg
                    <div>
                      <div style={{marginBottom:12}}>
                        {[
                          { label:"This MP's Net Worth",   value:netWorth,   color:sc(scr.subScores.incomeGap), max:Math.max(netWorth*1.2,10) },
                          { label:"Avg MP Net Worth",      value:14.7,        color:C.blue,                      max:Math.max(netWorth*1.2,10) },
                          { label:"Public Salary (30yr)",  value:4.5,         color:C.green,                     max:Math.max(netWorth*1.2,10) },
                        ].map((row,i)=>(
                          <div key={i} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                              <span style={{color:C.dim}}>{row.label}</span>
                              <span style={{fontWeight:700,color:row.color}}>₹{row.value}Cr</span>
                            </div>
                            <MiniBar v={(row.value/row.max)*100} color={row.color} h={8}/>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>
                        * Avg MP net worth: ₹14.7Cr (ADR 2024 data). Public servant 30yr salary baseline: ~₹4.5Cr.
                      </div>
                    </div>
                  )}
                </div>

                {/* Score radar */}
                <div className="card">
                  <Sec>Suspicion Profile</Sec>
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={C.border}/>
                      <PolarAngleAxis dataKey="dimension" tick={{fill:C.dim,fontSize:9}}/>
                      <Radar name="Score" dataKey="score" stroke={sc(scr.final)}
                        fill={sc(scr.final)} fillOpacity={0.2} strokeWidth={2}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Party criminal cases chart */}
              <div className="card">
                <Sec>Total Criminal Cases by Party</Sec>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={partyStats}>
                    <XAxis dataKey="party" tick={{fill:C.dim,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:C.dim,fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,fontSize:11}}/>
                    <Bar dataKey="totalCases" name="Cases" radius={[3,3,0,0]}>
                      {partyStats.map((p,i)=><Cell key={i} fill={(PARTY_C[p.party]||PARTY_C.IND).fg}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* All MPs score comparison */}
              <div className="card">
                <Sec>Suspicion Score — Top 30 of {initialData.length} MPs</Sec>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={sorted.slice(0,30).map(p=>({name:p.name.split(" ")[0],score:p.scoring.final}))}>
                    <XAxis dataKey="name" tick={{fill:C.dim,fontSize:9}} axisLine={false} tickLine={false}
                      interval={0} angle={-35} textAnchor="end" height={55}/>
                    <YAxis tick={{fill:C.dim,fontSize:10}} domain={[0,100]} axisLine={false} tickLine={false}/>
                    <Tooltip formatter={v=>[v,"Score"]} contentStyle={{background:C.card,border:`1px solid ${C.border}`,fontSize:11}}/>
                    <Bar dataKey="score" radius={[3,3,0,0]}>
                      {sorted.slice(0,30).map((p,i)=>(
                        <Cell key={i} fill={sc(p.scoring.final)} opacity={p.id===selId?1:0.45}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>)}

            {/* LIVE INTELLIGENCE */}
            {tab==="live"&&<LivePanel politician={sel} key={sel.id}/>}

            {/* SCORE BREAKDOWN */}
            {tab==="scoring"&&(
              <div className="card" style={{background:C.redBg,border:`1px solid ${C.red}22`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div><Sec>Final Suspicion Score</Sec>
                    <div style={{fontSize:11,color:C.dim}}>Computed live from ECI affidavit data</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:48,fontWeight:900,color:sc(scr.final),lineHeight:1}}>{scr.final}</div>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:1,color:sc(scr.final)}}>{scr.riskLevel}</div>
                  </div>
                </div>
                {DIMS.map((d,i)=>{
                  const raw=scr.subScores[d.key], weight=WEIGHTS[d.key], contrib=Math.round(raw*weight);
                  return (
                    <div key={i} style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}>
                        <div>
                          <span style={{fontWeight:700,fontSize:12}}>{d.label}</span>
                          <span style={{fontSize:10,color:C.muted,marginLeft:8}}>{d.desc}</span>
                        </div>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          <span style={{fontSize:10,color:C.dim}}>{raw} × {(weight*100).toFixed(0)}%</span>
                          <span style={{fontSize:14,fontWeight:800,color:sc(raw)}}>= {contrib}pts</span>
                        </div>
                      </div>
                      <MiniBar v={raw} color={sc(raw)} h={6}/>
                    </div>
                  );
                })}
                <div style={{borderTop:`1px solid ${C.red}22`,paddingTop:12,display:"flex",justifyContent:"flex-end",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:11,color:C.dim}}>Final Score:</span>
                  <span style={{fontSize:26,fontWeight:900,color:sc(scr.final)}}>{scr.final} / 100</span>
                </div>
              </div>
            )}

            {/* NETWORK */}
            {tab==="network"&&(
              <div className="card">
                <Sec>Family & Associates</Sec>
                {(!sel.network||sel.network.length===0)&&(
                  <div style={{color:C.muted,fontSize:12,padding:"12px 0"}}>No network data on record for this MP.</div>
                )}
                {sel.network?.map((n,i)=>{
                  const rsk=[(n.holdingsInConflictSectors?25:0),(n.tradeBeforePolicy?35:0),(n.govtContractWon?30:0)].reduce((a,b)=>a+b,0);
                  return (
                    <div key={i} style={{paddingBottom:14,marginBottom:14,borderBottom:i<sel.network.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:700,fontSize:14}}>{n.name}</div>
                          <Badge label={n.type.replace(/_/g," ").toUpperCase()} color={C.dim} bg={C.bg}/>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:20,fontWeight:800,color:sc(rsk)}}>{rsk}</div>
                          <div style={{fontSize:9,color:C.muted}}>RISK PTS</div>
                        </div>
                      </div>
                      <MiniBar v={rsk} color={sc(rsk)}/>
                      {n.note&&<div style={{marginTop:8,fontSize:12,color:C.dim,background:C.bg,padding:"7px 10px",borderRadius:4}}>{n.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* CASES */}
            {tab==="cases"&&(
              <div className="card">
                <Sec>Criminal Cases · ECI Affidavit + NJDG</Sec>
                {(!sel.criminalCases||sel.criminalCases.length===0)&&(
                  <div style={{color:C.green,fontSize:12,padding:"12px 0",fontWeight:600}}>✓ No criminal cases declared in affidavit.</div>
                )}
                {sel.criminalCases?.map((c,i)=>(
                  <div key={i} style={{paddingBottom:14,marginBottom:14,borderBottom:i<sel.criminalCases.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:6}}>
                      <span style={{fontWeight:700,fontSize:13}}>{c.case}</span>
                      <Badge label={c.status}
                        color={c.status==="PENDING"?C.orange:c.status==="ACQUITTED"?C.green:C.red}
                        bg={c.status==="PENDING"?C.orangeBg:c.status==="ACQUITTED"?C.greenBg:C.redBg}/>
                    </div>
                    {c.resolvedYear&&<div style={{fontSize:11,color:C.dim,marginBottom:4}}>Resolved: {c.resolvedYear}</div>}
                    {c.note&&<div style={{fontSize:12,background:C.bg,padding:"7px 10px",borderRadius:4,color:C.dim}}>{c.note}</div>}
                  </div>
                ))}
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                  <a href="https://njdg.ecourts.gov.in/njdgnew/index.php" target="_blank" rel="noreferrer"
                    style={{fontSize:11,color:C.blue,fontWeight:600}}>
                    Check live case status on NJDG →
                  </a>
                </div>
              </div>
            )}

            {/* PARTY */}
            {tab==="party"&&(<>
              <div className="card">
                <Sec>Net Worth by Party Affiliation</Sec>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={sel.partyHistory.map((p,i)=>({name:p.party,"Net Worth":Object.values(sel.totalAssets||{})[i]||0}))}>
                    <XAxis dataKey="name" tick={{fill:C.dim,fontSize:11}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:C.dim,fontSize:11}} axisLine={false} tickLine={false}/>
                    <Tooltip content={<TT/>}/>
                    <Bar dataKey="Net Worth" radius={[3,3,0,0]}>
                      {sel.partyHistory.map((p,i)=><Cell key={i} fill={(PARTY_C[p.party]||PARTY_C.IND).fg}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {sel.partyHistory.map((p,i)=>{
                const ppc3=PARTY_C[p.party]||PARTY_C.IND;
                return (
                  <div key={i} className="card" style={{borderLeft:`4px solid ${ppc3.fg}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><Badge label={p.party} color={ppc3.fg} bg={ppc3.bg}/>
                        <span style={{fontSize:11,color:C.muted,marginLeft:8}}>{p.from} – {p.to}</span>
                      </div>
                      <div style={{fontSize:22,fontWeight:800,color:ppc3.fg}}>₹{Object.values(sel.totalAssets||{})[i]||"—"}Cr</div>
                    </div>
                  </div>
                );
              })}
            </>)}

            {/* TIMELINE */}
            {tab==="timeline"&&(
              <div className="card">
                <Sec>Activity Timeline</Sec>
                {(!sel.timeline||sel.timeline.length===0)&&(
                  <div style={{color:C.muted,fontSize:12,padding:"12px 0"}}>
                    No timeline data yet. Use the <button onClick={()=>setTab("live")}
                      style={{background:"none",border:"none",color:C.blue,cursor:"pointer",fontWeight:600,fontSize:12}}>
                      ● Live tab
                    </button> to pull recent news and court activity.
                  </div>
                )}
                <div style={{position:"relative"}}>
                  <div style={{position:"absolute",left:36,top:0,bottom:0,width:1,background:C.border}}/>
                  {sel.timeline?.map((t,i)=>{
                    const color=TL_C[t.type]||C.dim;
                    return (
                      <div key={i} style={{display:"flex",marginBottom:4}}>
                        <div style={{width:36,flexShrink:0,paddingTop:3,paddingRight:10,fontSize:9,color:C.muted,textAlign:"right",lineHeight:1.4}}>
                          {t.date.split(" ").map((s,j)=><div key={j}>{s}</div>)}
                        </div>
                        <div style={{flex:1,paddingLeft:16,paddingBottom:12,position:"relative"}}>
                          <div style={{width:10,height:10,borderRadius:"50%",border:"2px solid white",
                            position:"absolute",left:-5,top:3,background:t.flag?C.red:color,
                            boxShadow:t.flag?`0 0 0 3px ${C.redBg}`:"none"}}/>
                          <div style={{background:t.flag?C.redBg:C.bg,borderRadius:5,padding:"8px 10px",
                            border:`1px solid ${t.flag?C.red+"33":C.border}`}}>
                            <div style={{display:"flex",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                              <Badge label={t.type.toUpperCase()} color={color} bg={color+"18"}/>
                              {t.flag&&<Badge label="⚠ FLAGGED" color={C.red} bg={C.redBg}/>}
                            </div>
                            <div style={{fontSize:12,color:C.ink}}>{t.event}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,fontSize:10,color:C.muted,lineHeight:1.7,textAlign:"center"}}>
              NetaWatch uses publicly available data from ECI, MCA21, NJDG, and Sansad.in. Public interest transparency project.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
