"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import { WEIGHTS, DIMS } from "../lib/scoring";

const C = {
  bg:"#F4F4F4", card:"#FFFFFF", ink:"#111111", dim:"#555555",
  muted:"#999999", border:"#E8E8E8",
  red:"#D0021B",    redBg:"#FFF0F1",
  orange:"#C45000", orangeBg:"#FFF4EE",
  green:"#1A7A3C",  greenBg:"#F0FAF3",
  blue:"#1A56A0",   blueBg:"#EFF4FF",
  purple:"#6B21A8", purpleBg:"#F5F0FF",
};
const PARTY_C = {
  BJP:{ fg:"#E8450A", bg:"#FFF1EC" }, INC:{ fg:"#1155AA", bg:"#EEF4FF" },
  NCP:{ fg:"#6B21A8", bg:"#F5F0FF" }, AAP:{ fg:"#007A82", bg:"#EDFAFA" },
  TMC:{ fg:"#00695C", bg:"#E0F2F1" }, AITC:{ fg:"#00695C", bg:"#E0F2F1" },
  SP:{ fg:"#D84315", bg:"#FBE9E7" },  BSP:{ fg:"#1565C0", bg:"#E3F2FD" },
  DMK:{ fg:"#C62828", bg:"#FFEBEE" }, JDU:{ fg:"#00838F", bg:"#E0F7FA" },
  RJD:{ fg:"#AD1457", bg:"#FCE4EC" }, IND:{ fg:"#455A64", bg:"#ECEFF1" },
};

const FLAG_COLORS = {
  WEALTH:    { icon:"💰", color:C.orange, bg:C.orangeBg },
  MCA21:     { icon:"🏢", color:C.purple, bg:C.purpleBg },
  BONDS:     { icon:"🏦", color:C.red,    bg:C.redBg    },
  CASES:     { icon:"⚖️",  color:C.red,    bg:C.redBg    },
  DIRECTORSHIP:{ icon:"🏢", color:C.purple, bg:C.purpleBg },
  ELECTORAL_BOND:{ icon:"🏦", color:C.red, bg:C.redBg  },
  DEFAULT:   { icon:"🚩", color:C.orange, bg:C.orangeBg },
};

const sc  = v => v>=75?C.red:v>=55?C.orange:v>=35?"#B08000":C.green;
const pc  = p => PARTY_C[p?.toUpperCase()] || PARTY_C.IND;

function proxyPhoto(url) {
  if (!url) return "";
  if (url.includes("weserv.nl")) return url;
  if (url.includes("wikimedia") || url.includes("wikipedia"))
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=120&h=120&fit=cover&mask=circle`;
  return url;
}

// ── Components ────────────────────────────────────────────────────────────────
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
    <div style={{width:`${Math.min(v,100)}%`,height:"100%",background:color,borderRadius:3,transition:"width .5s"}}/>
  </div>
);

const Badge = ({ label, color, bg, size=10 }) => (
  <span style={{display:"inline-flex",alignItems:"center",fontSize:size,fontWeight:700,
    padding:"2px 7px",borderRadius:3,background:bg||"transparent",
    color:color||C.dim,border:`1px solid ${(color||C.dim)+"22"}`}}>{label}</span>
);

const Sec = ({ children, action }) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
    <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1}}>{children}</div>
    {action}
  </div>
);

function Avatar({ p, size=40 }) {
  const [err, setErr] = useState(false);
  const ppc = pc(p.party), photo = proxyPhoto(p.photo);
  if (photo && !err)
    return <img src={photo} alt={p.name} onError={()=>setErr(true)}
      style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",
        border:`2px solid ${ppc.fg}`,flexShrink:0,background:ppc.bg}}/>;
  return (
    <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,
      background:ppc.bg,border:`2px solid ${ppc.fg}`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:size*.28,fontWeight:800,color:ppc.fg}}>
      {p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
    </div>
  );
}

const Stat = ({ label, value, color, sub }) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,
    padding:"12px 10px",textAlign:"center",borderTop:`3px solid ${color||C.border}`}}>
    <div style={{fontSize:18,fontWeight:800,color:color||C.ink,lineHeight:1}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:C.green,fontWeight:600,marginTop:2}}>{sub}</div>}
    <div style={{fontSize:9,color:C.muted,marginTop:4,textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
  </div>
);

// Corruption flag card — the main new component
function FlagCard({ flag }) {
  const fc = FLAG_COLORS[flag.type] || FLAG_COLORS.DEFAULT;
  return (
    <div style={{display:"flex",gap:10,padding:"10px 12px",marginBottom:6,
      background:fc.bg,borderLeft:`3px solid ${fc.color}`,borderRadius:"0 5px 5px 0"}}>
      <span style={{fontSize:16,flexShrink:0}}>{flag.icon || fc.icon}</span>
      <div style={{flex:1}}>
        <div style={{fontSize:12,color:C.ink,lineHeight:1.5}}>{flag.text}</div>
        {flag.source&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Source: {flag.source}</div>}
      </div>
      <Badge label={flag.type} color={fc.color} bg={fc.bg}/>
    </div>
  );
}

// Electoral bonds breakdown
function BondsPanel({ bonds, party }) {
  if (!bonds) return (
    <div style={{color:C.muted,fontSize:12,padding:"12px 0"}}>
      Electoral bonds data will appear after running the enrichment script.
    </div>
  );
  const ppc = pc(party);
  return (
    <div>
      <div style={{display:"flex",gap:12,marginBottom:16}}>
        <div style={{flex:1,background:C.bg,borderRadius:6,padding:"12px",textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:800,color:ppc.fg}}>₹{bonds.partyReceivedCr?.toFixed(0)||0}Cr</div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Received by Party</div>
        </div>
        <div style={{flex:1,background:bonds.suspiciousDonors?.length?C.redBg:C.greenBg,
          borderRadius:6,padding:"12px",textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:800,color:bonds.suspiciousDonors?.length?C.red:C.green}}>
            {bonds.suspiciousDonors?.length||0}
          </div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>Flagged Donors</div>
        </div>
      </div>
      {bonds.topDonors?.length>0&&(<>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
          Top Bond Donors to Party
        </div>
        {bonds.topDonors.map((d,i)=>{
          const flagged = bonds.suspiciousDonors?.some(s=>s.name===d.name);
          return (
            <div key={i} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:600,color:flagged?C.red:C.ink}}>{d.name}</span>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:700}}>₹{d.amountCr}Cr</span>
                  {flagged&&<Badge label="⚠ FLAGGED" color={C.red} bg={C.redBg}/>}
                </div>
              </div>
              <MiniBar v={(d.amountCr/bonds.topDonors[0].amountCr)*100} color={flagged?C.red:C.blue}/>
            </div>
          );
        })}
      </>)}
      <div style={{marginTop:12,fontSize:10,color:C.muted}}>
        Source: ECI Electoral Bonds Disclosure · SBI data released per Supreme Court order March 2024
      </div>
    </div>
  );
}

// MCA21 directorships panel
function DirectorshipsPanel({ directorships }) {
  if (!directorships?.length) return (
    <div style={{color:C.muted,fontSize:12,padding:"12px 0"}}>
      No MCA21 data yet. Run enrich-corruption.js to fetch company directorships.
      <br/><br/>
      <a href="https://www.mca.gov.in/mcafoportal/showdirectorMasterData.do"
        target="_blank" rel="noreferrer" style={{color:C.blue,fontSize:11}}>
        Check manually on MCA21 →
      </a>
    </div>
  );
  const active = directorships.filter(d => !d.dateOfCessation?.trim());
  const postAppt = directorships.filter(d => d.formedAfterAppt);
  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:14}}>
        {[
          ["Total Companies", directorships.length, C.ink],
          ["Currently Active", active.length, C.orange],
          ["Post-Appointment", postAppt.length, postAppt.length>0?C.red:C.green],
        ].map(([l,v,c],i)=>(
          <div key={i} style={{flex:1,background:C.bg,borderRadius:5,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      {directorships.map((d,i)=>(
        <div key={i} style={{padding:"10px 12px",marginBottom:6,background:C.bg,borderRadius:5,
          borderLeft:`3px solid ${d.formedAfterAppt?C.red:d.dateOfCessation?C.muted:C.orange}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>{d.name}</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                CIN: {d.cin||"—"} · Joined: {d.dateOfJoining||"—"}
                {d.dateOfCessation&&` · Left: ${d.dateOfCessation}`}
              </div>
            </div>
            <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
              {d.formedAfterAppt&&<Badge label="POST-APPT" color={C.red} bg={C.redBg}/>}
              <Badge label={d.dateOfCessation?"CEASED":"ACTIVE"}
                color={d.dateOfCessation?C.muted:C.orange}
                bg={d.dateOfCessation?"#f5f5f5":C.orangeBg}/>
            </div>
          </div>
        </div>
      ))}
      <div style={{marginTop:8,fontSize:10,color:C.muted}}>
        Source: MCA21 Director Master Data (Ministry of Corporate Affairs)
      </div>
    </div>
  );
}

// Live news + court panel (auto-loads)
function LivePanel({ p }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setData(null); setLoading(true);
    const params = new URLSearchParams({ name: p.name, constituency: p.constituency||"" });
    fetch(`/api/enrich/${p.id}?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if(d) setData(d); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  }, [p.id]);

  if (loading) return (
    <div style={{padding:"24px 0",textAlign:"center",color:C.muted,fontSize:12}}>
      <div style={{fontSize:24,marginBottom:8,animation:"pulse 1s infinite"}}>📡</div>
      Fetching live news and court updates…
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {data?.lastUpdated&&(
        <div style={{fontSize:10,color:C.muted,textAlign:"right"}}>
          Updated: {new Date(data.lastUpdated).toLocaleString("en-IN")}
        </div>
      )}
      {data?.courtStatus?.length>0&&(
        <div style={{background:C.redBg,borderRadius:6,padding:"12px 14px",border:`1px solid ${C.red}22`}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:8,color:C.red}}>⚖️ Recent Court Activity</div>
          {data.courtStatus.map((item,i)=>(
            <div key={i} style={{fontSize:12,color:C.ink,marginBottom:6,paddingBottom:6,
              borderBottom:i<data.courtStatus.length-1?`1px solid ${C.border}`:"none"}}>
              {item.title}
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{item.pubDate}</div>
            </div>
          ))}
        </div>
      )}
      {data?.news?.length>0&&(
        <div style={{background:C.bg,borderRadius:6,padding:"12px 14px"}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>📰 Latest News</div>
          {data.news.map((item,i)=>(
            <div key={i} style={{marginBottom:8,paddingBottom:8,
              borderBottom:i<data.news.length-1?`1px solid ${C.border}`:"none"}}>
              <a href={item.link} target="_blank" rel="noreferrer"
                style={{fontSize:12,color:C.ink,textDecoration:"none",fontWeight:500,lineHeight:1.5,display:"block"}}>
                {item.title}
              </a>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>{item.source} · {item.pubDate}</div>
            </div>
          ))}
        </div>
      )}
      {(!data||(!data.news?.length&&!data.courtStatus?.length))&&(
        <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"12px 0"}}>
          No recent news found. Check directly:
          <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:10,flexWrap:"wrap"}}>
            {[["NJDG","https://njdg.ecourts.gov.in"],["Sansad.in","https://sansad.in"],
              ["ED/CBI","https://enforcementdirectorate.gov.in"]].map(([l,u],i)=>(
              <a key={i} href={u} target="_blank" rel="noreferrer"
                style={{fontSize:11,color:C.blue,padding:"4px 10px",border:`1px solid ${C.blue}33`,
                  borderRadius:4,textDecoration:"none",background:C.blueBg}}>{l} →</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Scrolling ticker
function Ticker({ politicians }) {
  const [offset, setOffset] = useState(0);
  useEffect(()=>{
    const t=setInterval(()=>setOffset(o=>o+1),35); return ()=>clearInterval(t);
  },[]);
  const text = politicians.slice(0,20)
    .map(p=>`${p.name} (${p.party}) ▸ ₹${Object.values(p.totalAssets||{}).pop()||0}Cr ▸ Score:${p.scoring?.final||0} ▸ Cases:${p.criminalCases?.length||0}`)
    .join("   ·   ");
  const doubled = text + "   ·   " + text;
  const x = -(offset % (text.length * 7.5));
  return (
    <div style={{background:"#0a0a0a",height:26,overflow:"hidden",borderBottom:"1px solid #1a1a1a"}}>
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

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  const [selId,    setSelId]    = useState(initialData[0]?.id);
  const [tab,      setTab]      = useState("overview");
  const [search,   setSearch]   = useState("");
  const [sortBy,   setSortBy]   = useState("score");
  const [chamber,  setChamber]  = useState("ALL"); // ALL | LS | RS
  const [clock,    setClock]    = useState("");

  useEffect(()=>{
    const tick=()=>setClock(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}));
    tick(); const t=setInterval(tick,30000); return ()=>clearInterval(t);
  },[]);

  const sorted = useMemo(()=>{
    const arr=[...initialData];
    if(sortBy==="score")  return arr.sort((a,b)=>b.scoring.final-a.scoring.final);
    if(sortBy==="assets") return arr.sort((a,b)=>(Object.values(b.totalAssets||{}).pop()||0)-(Object.values(a.totalAssets||{}).pop()||0));
    if(sortBy==="cases")  return arr.sort((a,b)=>(b.criminalCases?.length||0)-(a.criminalCases?.length||0));
    if(sortBy==="flags")  return arr.sort((a,b)=>(b.scoring.flags?.length||0)-(a.scoring.flags?.length||0));
    if(sortBy==="name")   return arr.sort((a,b)=>a.name.localeCompare(b.name));
    return arr;
  },[initialData,sortBy]);

  const filtered = useMemo(()=>
    sorted.filter(p=> {
      if (chamber==="LS" && p.chamber==="RS") return false;
      if (chamber==="RS" && p.chamber!=="RS") return false;
      return `${p.name} ${p.party} ${p.state} ${p.constituency}`.toLowerCase().includes(search.toLowerCase());
    })
  ,[sorted,search,chamber]);

  const sel = initialData.find(p=>p.id===selId)||initialData[0];
  const scr = sel.scoring;
  const ppc = pc(sel.party);

  const assetYears  = Object.keys(sel.totalAssets||{}).sort();
  const latestYear  = assetYears[assetYears.length-1]||"2024";
  const earliest    = assetYears[0]||"2024";
  const netWorth    = sel.totalAssets[latestYear]||0;
  const growthPct   = assetYears.length>=2
    ? (((netWorth-(sel.totalAssets[earliest]||0))/(sel.totalAssets[earliest]||1))*100).toFixed(0) : null;

  const lsCount   = useMemo(()=>initialData.filter(p=>p.chamber!=="RS").length,[initialData]);
  const rsCount   = useMemo(()=>initialData.filter(p=>p.chamber==="RS").length,[initialData]);
  const totalCases= useMemo(()=>initialData.reduce((s,p)=>s+(p.criminalCases?.length||0),0),[initialData]);
  const flagged   = useMemo(()=>initialData.filter(p=>(p.scoring.flags?.length||0)>0).length,[initialData]);

  const partyStats = useMemo(()=>{
    const map={};
    initialData.forEach(p=>{
      if(!map[p.party]) map[p.party]={count:0,totalCases:0,totalAssets:0};
      map[p.party].count++;
      map[p.party].totalCases+=(p.criminalCases?.length||0);
      map[p.party].totalAssets+=(Object.values(p.totalAssets||{}).pop()||0);
    });
    return Object.entries(map)
      .map(([party,s])=>({party,count:s.count,totalCases:s.totalCases,avgAssets:Math.round(s.totalAssets/s.count)}))
      .sort((a,b)=>b.totalCases-a.totalCases).slice(0,10);
  },[initialData]);

  const radarData = DIMS.map(d=>({ subject:d.label, score:scr.subScores[d.key]||0, fullMark:100 }));

  const TABS=[["overview","Overview"],["corruption","🚩 Corruption"],["bonds","🏦 Bonds"],
    ["companies","🏢 Companies"],["live","📡 Live"],["cases","Cases"],["party","Party"]];

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      background:C.bg,minHeight:"100vh",color:C.ink,fontSize:13,lineHeight:1.5}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}::-webkit-scrollbar-thumb{background:#DDD;border-radius:2px;}
        .tab{background:none;border:none;border-bottom:2px solid transparent;color:${C.muted};
          padding:9px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s;}
        .tab.on{color:${C.ink};border-bottom-color:${C.ink};}.tab:hover{color:${C.ink};}
        .prow{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;
          border-bottom:1px solid ${C.border};border-left:3px solid transparent;transition:background .1s;}
        .prow:hover{background:#F9F9F9;}.prow.on{background:${C.card};border-left-color:${C.red};}
        .card{background:${C.card};border:1px solid ${C.border};border-radius:6px;padding:14px 16px;}
        .search{width:100%;background:${C.bg};border:1px solid ${C.border};border-radius:4px;
          padding:8px 10px;font-size:12px;font-family:inherit;outline:none;color:${C.ink};}
        .search:focus{border-color:${C.ink};}.search::placeholder{color:${C.muted};}
        .srt{background:none;border:1px solid ${C.border};border-radius:3px;padding:3px 8px;
          font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;color:${C.dim};transition:all .1s;}
        .srt.on{background:${C.ink};color:#fff;border-color:${C.ink};}
        .chbtn{padding:3px 10px;border:1px solid ${C.border};border-radius:3px;font-size:10px;
          font-weight:700;cursor:pointer;font-family:inherit;background:none;color:${C.dim};}
        .chbtn.on{background:${C.ink};color:#fff;border-color:${C.ink};}
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
            <span style={{fontSize:9,color:"#22C55E",letterSpacing:1,fontWeight:700}}>LIVE</span>
          </div>
          <span style={{fontSize:10,color:"#888"}}>{initialData.length} politicians</span>
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

          {/* Chamber + Sort */}
          <div style={{padding:"6px 12px 8px",borderBottom:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:6}}>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginRight:2}}>House:</span>
              {[["ALL","All"],["LS","Lok Sabha"],["RS","Rajya Sabha"]].map(([k,l])=>(
                <button key={k} className={`chbtn ${chamber===k?"on":""}`} onClick={()=>setChamber(k)}>{l}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginRight:2}}>Sort:</span>
              {[["score","Score"],["assets","Wealth"],["cases","Cases"],["flags","Flags"],["name","A–Z"]].map(([k,l])=>(
                <button key={k} className={`srt ${sortBy===k?"on":""}`} onClick={()=>setSortBy(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div style={{padding:"6px 14px 4px",fontSize:10,color:C.muted,fontWeight:600,letterSpacing:1,textTransform:"uppercase"}}>
            {filtered.length} / {initialData.length}
          </div>

          {filtered.map(p=>{
            const ppc2=pc(p.party), flags=p.scoring.flags?.length||0;
            return (
              <div key={p.id} className={`prow ${selId===p.id?"on":""}`}
                onClick={()=>{setSelId(p.id);setTab("overview");}}>
                <Avatar p={p} size={38}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.name}
                    {p.chamber==="RS"&&<span style={{fontSize:9,color:C.muted,marginLeft:4}}>RS</span>}
                  </div>
                  <div style={{fontSize:10,color:C.dim,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <span style={{color:ppc2.fg,fontWeight:700}}>{p.party}</span>{" · "}{p.state||p.constituency}
                    {flags>0&&<span style={{color:C.red,fontWeight:700,marginLeft:4}}>🚩{flags}</span>}
                  </div>
                  <MiniBar v={p.scoring.final} color={sc(p.scoring.final)} h={3}/>
                </div>
                <Ring score={p.scoring.final} size={40}/>
              </div>
            );
          })}

          {filtered.length===0&&<div style={{padding:"24px",textAlign:"center",color:C.muted,fontSize:12}}>No results</div>}

          {/* Footer stats */}
          <div style={{marginTop:"auto",padding:"12px 14px",borderTop:`1px solid ${C.border}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
              {[
                ["LS MPs",lsCount,C.blue],[" RS MPs",rsCount,C.purple],
                ["Cases",totalCases,C.red],["Flagged",flagged,C.orange],
              ].map(([l,v,c],i)=>(
                <div key={i} style={{textAlign:"center",background:C.bg,borderRadius:4,padding:"6px 4px"}}>
                  <div style={{fontSize:15,fontWeight:800,color:c}}>{v}</div>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                </div>
              ))}
            </div>
            <p style={{fontSize:10,color:C.muted,lineHeight:1.7}}>
              Sources: ECI · MCA21 · NJDG · Sansad.in · SBI Electoral Bonds
            </p>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{overflowY:"auto",background:C.bg}}>
          <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"16px 16px 0"}} className="fadein">
            {/* Identity */}
            <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:14}}>
              <Avatar p={sel} size={72}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:4,fontWeight:600}}>
                  {sel.chamber==="RS"?"Rajya Sabha":"Lok Sabha"} · ECI Public Record
                </div>
                <h1 style={{fontSize:20,fontWeight:800,letterSpacing:-.3,marginBottom:6}}>{sel.name}</h1>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
                  <Badge label={sel.party} color={ppc.fg} bg={ppc.bg} size={11}/>
                  <span style={{fontSize:11,color:C.dim}}>{sel.role}</span>
                </div>
                <div style={{fontSize:11,color:C.dim}}>
                  {[sel.constituency,sel.state,sel.education].filter(Boolean).join(" · ")}
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
              <Stat label="Net Worth"    value={`₹${netWorth}Cr`}/>
              <Stat label={growthPct?`Growth`:"Declared"} value={growthPct?`+${growthPct}%`:`₹${netWorth}Cr`} color={C.green}/>
              <Stat label="Criminal Cases" value={sel.criminalCases?.length||0}
                color={(sel.criminalCases?.length||0)>0?C.red:C.green}/>
              <Stat label="Companies (MCA)"
                value={sel.directorships?.length||"—"}
                color={(sel.directorships?.length||0)>2?C.orange:C.dim}/>
              <Stat label="Corruption Flags"
                value={scr.flags?.length||0}
                color={(scr.flags?.length||0)>0?C.red:C.green}/>
            </div>

            {/* Flags — shown prominently always */}
            {scr.flags?.length>0&&(
              <div style={{marginBottom:12}}>
                {scr.flags.map((f,i)=><FlagCard key={i} flag={f}/>)}
              </div>
            )}

            {/* Sub-scores */}
            <div className="g3" style={{marginBottom:12}}>
              {DIMS.map((d,i)=>{
                const v=scr.subScores[d.key]||0;
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
                <button key={k} className={`tab ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{l}</button>
              ))}
            </div>
          </div>

          {/* TAB CONTENT */}
          <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>

            {/* OVERVIEW */}
            {tab==="overview"&&(<>
              <div className="g2">
                <div className="card">
                  <Sec>Declared Wealth (₹Cr)</Sec>
                  {assetYears.length>=2?(
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={assetYears.map(y=>({y,assets:sel.totalAssets[y],liab:sel.liabilities?.[y]||0}))}>
                        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.blue} stopOpacity={0.15}/>
                          <stop offset="100%" stopColor={C.blue} stopOpacity={0}/>
                        </linearGradient></defs>
                        <XAxis dataKey="y" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
                        <Tooltip content={({active,payload,label})=>active&&payload?.length?(
                          <div style={{background:C.card,border:`1px solid ${C.border}`,padding:"8px 12px",fontSize:11}}>
                            <div style={{color:C.muted,marginBottom:4}}>{label}</div>
                            {payload.map((p,i)=><div key={i} style={{color:p.color,fontWeight:600}}>{p.name}: ₹{p.value}Cr</div>)}
                          </div>):null}/>
                        <Area dataKey="assets" name="Assets" stroke={C.blue} strokeWidth={2} fill="url(#ag)"/>
                        <Area dataKey="liab" name="Liabilities" stroke={C.red} strokeWidth={1.5} fill="none" strokeDasharray="4 2"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  ):(
                    <div style={{padding:"8px 0"}}>
                      {[{l:"This MP",v:netWorth,c:sc(scr.subScores.wealthGap)},
                        {l:"Avg MP (ADR 2024)",v:14.7,c:C.blue},
                        {l:"30yr Govt Salary",v:4.5,c:C.green}].map((r,i)=>(
                        <div key={i} style={{marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                            <span style={{color:C.dim}}>{r.l}</span>
                            <span style={{fontWeight:700,color:r.c}}>₹{r.v}Cr</span>
                          </div>
                          <MiniBar v={(r.v/Math.max(netWorth,15))*100} color={r.c} h={8}/>
                        </div>
                      ))}
                      <div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>
                        * Avg MP wealth ₹14.7Cr · ADR 2024. Public salary baseline ₹4.5Cr over 30yr career.
                      </div>
                    </div>
                  )}
                </div>
                <div className="card">
                  <Sec>Suspicion Profile</Sec>
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={C.border}/>
                      <PolarAngleAxis dataKey="subject" tick={{fill:C.dim,fontSize:9}}/>
                      <Radar dataKey="score" stroke={sc(scr.final)} fill={sc(scr.final)} fillOpacity={0.2} strokeWidth={2}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="card">
                <Sec>Party-wise Declared Criminal Cases</Sec>
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
            </>)}

            {/* CORRUPTION FLAGS */}
            {tab==="corruption"&&(
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div className="card">
                  <Sec>Corruption Risk Score</Sec>
                  <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:16}}>
                    <Ring score={scr.final} size={80}/>
                    <div>
                      <div style={{fontSize:28,fontWeight:900,color:sc(scr.final),lineHeight:1}}>{scr.riskLevel}</div>
                      <div style={{fontSize:12,color:C.dim,marginTop:4}}>Based on ECI + MCA21 + Electoral Bonds data</div>
                    </div>
                  </div>
                  {DIMS.map((d,i)=>{
                    const v=scr.subScores[d.key]||0, w=WEIGHTS[d.key];
                    return (
                      <div key={i} style={{marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}>
                          <div>
                            <span style={{fontWeight:700,fontSize:12}}>{d.label}</span>
                            <span style={{fontSize:10,color:C.muted,marginLeft:8}}>{d.desc}</span>
                          </div>
                          <div style={{display:"flex",gap:10,alignItems:"center"}}>
                            <span style={{fontSize:10,color:C.dim}}>{v} × {(w*100).toFixed(0)}%</span>
                            <span style={{fontSize:14,fontWeight:800,color:sc(v)}}>= {Math.round(v*w)}pts</span>
                          </div>
                        </div>
                        <MiniBar v={v} color={sc(v)} h={6}/>
                      </div>
                    );
                  })}
                </div>
                {scr.flags?.length>0&&(
                  <div className="card">
                    <Sec>Active Corruption Signals ({scr.flags.length})</Sec>
                    {scr.flags.map((f,i)=><FlagCard key={i} flag={f}/>)}
                  </div>
                )}
                {scr.flags?.length===0&&(
                  <div className="card" style={{textAlign:"center",padding:"24px",color:C.muted}}>
                    <div style={{fontSize:32,marginBottom:8}}>✅</div>
                    No corruption flags detected from available data sources.
                    <br/>
                    <span style={{fontSize:11}}>Note: absence of flags ≠ absence of corruption. Run enrichment script for full analysis.</span>
                  </div>
                )}
              </div>
            )}

            {/* ELECTORAL BONDS */}
            {tab==="bonds"&&(
              <div className="card">
                <Sec>Electoral Bonds · SBI Disclosure (Supreme Court Order 2024)</Sec>
                <BondsPanel bonds={sel.electoralBonds} party={sel.party}/>
              </div>
            )}

            {/* MCA21 COMPANIES */}
            {tab==="companies"&&(
              <div className="card">
                <Sec>Company Directorships · MCA21</Sec>
                <DirectorshipsPanel directorships={sel.directorships}/>
              </div>
            )}

            {/* LIVE NEWS + COURT */}
            {tab==="live"&&(
              <div className="card">
                <Sec>Live Intelligence · News + Court + Parliament</Sec>
                <LivePanel p={sel} key={sel.id}/>
              </div>
            )}

            {/* CASES */}
            {tab==="cases"&&(
              <div className="card">
                <Sec>Criminal Cases · ECI Affidavit Declaration</Sec>
                {(!sel.criminalCases||sel.criminalCases.length===0)&&(
                  <div style={{color:C.green,fontSize:12,padding:"12px 0",fontWeight:600}}>
                    ✓ No criminal cases declared in affidavit.
                  </div>
                )}
                {sel.criminalCases?.map((c,i)=>(
                  <div key={i} style={{paddingBottom:14,marginBottom:14,
                    borderBottom:i<sel.criminalCases.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:6}}>
                      <span style={{fontWeight:700,fontSize:13}}>{c.case}</span>
                      <Badge label={c.status}
                        color={c.status==="PENDING"?C.orange:c.status==="ACQUITTED"?C.green:C.red}
                        bg={c.status==="PENDING"?C.orangeBg:c.status==="ACQUITTED"?C.greenBg:C.redBg}/>
                    </div>
                    {c.note&&<div style={{fontSize:12,background:C.bg,padding:"7px 10px",borderRadius:4,color:C.dim}}>{c.note}</div>}
                  </div>
                ))}
                <a href="https://njdg.ecourts.gov.in" target="_blank" rel="noreferrer"
                  style={{fontSize:11,color:C.blue,fontWeight:600,display:"block",marginTop:8}}>
                  Check live hearing dates on NJDG →
                </a>
              </div>
            )}

            {/* PARTY */}
            {tab==="party"&&(<>
              <div className="card">
                <Sec>Party-wise Wealth vs Cases</Sec>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={partyStats}>
                    <XAxis dataKey="party" tick={{fill:C.dim,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis yAxisId="left" tick={{fill:C.dim,fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis yAxisId="right" orientation="right" tick={{fill:C.dim,fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,fontSize:11}}/>
                    <Bar yAxisId="left" dataKey="avgAssets" name="Avg Assets (Cr)" radius={[3,3,0,0]}>
                      {partyStats.map((p,i)=><Cell key={i} fill={(PARTY_C[p.party]||PARTY_C.IND).fg} opacity={0.5}/>)}
                    </Bar>
                    <Bar yAxisId="right" dataKey="totalCases" name="Total Cases" radius={[3,3,0,0]}>
                      {partyStats.map((p,i)=><Cell key={i} fill={(PARTY_C[p.party]||PARTY_C.IND).fg}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {sel.partyHistory.map((ph,i)=>{
                const ppc3=PARTY_C[ph.party]||PARTY_C.IND;
                return (
                  <div key={i} className="card" style={{borderLeft:`4px solid ${ppc3.fg}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><Badge label={ph.party} color={ppc3.fg} bg={ppc3.bg} size={12}/>
                        <span style={{fontSize:11,color:C.muted,marginLeft:8}}>{ph.from}–{ph.to}</span>
                      </div>
                      <div style={{fontSize:20,fontWeight:800,color:ppc3.fg}}>
                        ₹{Object.values(sel.totalAssets||{})[i]||"—"}Cr
                      </div>
                    </div>
                  </div>
                );
              })}
            </>)}

            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,fontSize:10,color:C.muted,lineHeight:1.8,textAlign:"center"}}>
              NetaWatch uses publicly available data from ECI affidavits, MCA21, NJDG, Sansad.in, and SBI Electoral Bonds disclosure.<br/>
              Public interest transparency project. All data is on public record.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
