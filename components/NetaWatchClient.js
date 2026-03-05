"use client";
import { useState, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { WEIGHTS } from "@/lib/scoring";

// ── Constants ────────────────────────────────────────────────────────────────
const C = {
  bg:"#F4F4F4", card:"#FFFFFF", ink:"#111111", dim:"#555555",
  muted:"#999999", border:"#E8E8E8",
  red:"#D0021B",    redBg:"#FFF0F1",
  orange:"#C45000", orangeBg:"#FFF4EE",
  green:"#1A7A3C",  greenBg:"#F0FAF3",
  blue:"#1A56A0",   blueBg:"#EFF4FF",
};
const PARTY_C = {
  BJP:{ fg:"#E8450A", bg:"#FFF1EC" },
  INC:{ fg:"#1155AA", bg:"#EEF4FF" },
  NCP:{ fg:"#6B21A8", bg:"#F5F0FF" },
  AAP:{ fg:"#007A82", bg:"#EDFAFA" },
  SP: { fg:"#D84315", bg:"#FBE9E7" },
  TMC:{ fg:"#00695C", bg:"#E0F2F1" },
  IND:{ fg:"#455A64", bg:"#ECEFF1" },
};
const TL_C = {
  party:"#6B21A8", legal:C.red, appt:C.orange,
  trade:C.blue, policy:"#444", gain:C.green, contract:C.orange,
};
const DIMS = [
  { key:"incomeGap",      label:"Income Gap",     desc:"Asset growth vs declared income"  },
  { key:"sectorConflict", label:"Conflict",        desc:"Holdings in regulated sectors"    },
  { key:"tradeTiming",    label:"Timing",          desc:"Trades near policy events"        },
  { key:"caseDisposal",   label:"Cases",           desc:"Cases dropped after party switch" },
  { key:"networkRisk",    label:"Network",         desc:"Family & associate activity"      },
  { key:"disclosure",     label:"Disclosure",      desc:"Late or amended declarations"     },
];

// ── Tiny helpers ─────────────────────────────────────────────────────────────
const sc = v => v>=80?C.red:v>=60?C.orange:"#B08000";

const Ring = ({ score, size=56 }) => {
  const r=size/2-5, circ=2*Math.PI*r, color=sc(score);
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={4}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        style={{fontSize:size*.22,fontWeight:800,fill:color,fontFamily:"inherit"}}>
        {score}
      </text>
    </svg>
  );
};

const MiniBar = ({ v, color, h=4 }) => (
  <div style={{background:C.border,borderRadius:3,height:h,overflow:"hidden"}}>
    <div style={{width:`${Math.min(v,100)}%`,height:"100%",background:color,borderRadius:3,transition:"width .4s ease"}}/>
  </div>
);

const Badge = ({ label, color, bg }) => (
  <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:700,
    padding:"2px 8px",borderRadius:3,background:bg||"transparent",
    color:color||C.dim,border:`1px solid ${(color||C.dim)+"22"}`}}>{label}</span>
);

const Sec = ({ children }) => (
  <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",
    letterSpacing:1,marginBottom:12}}>{children}</div>
);

const TT = ({ active, payload, label }) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,padding:"8px 12px",
      fontSize:11,boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
      <div style={{color:C.muted,marginBottom:4}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color,fontWeight:600}}>
          {p.name}: ₹{p.value}Cr
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  const [selId,  setSelId]  = useState(initialData[0]?.id);
  const [tab,    setTab]    = useState("overview");
  const [search, setSearch] = useState("");
  const [showAllFlags, setShowAllFlags] = useState(false);

  const filtered = useMemo(()=>
    initialData.filter(p=>
      `${p.name} ${p.party} ${p.state} ${p.constituency}`
        .toLowerCase().includes(search.toLowerCase())
    ), [initialData, search]);

  const sel = initialData.find(p=>p.id===selId) || initialData[0];
  const { scoring } = sel;

  const assetData = Object.entries(sel.totalAssets).map(([y,v])=>({
    y, assets:v, liab:sel.liabilities?.[y]||0
  }));
  const growthPct = (((sel.totalAssets[2024]-sel.totalAssets[2009])/sel.totalAssets[2009])*100).toFixed(0);
  const totalDeclared = Object.values(sel.declaredIncome).reduce((a,b)=>a+b,0).toFixed(2);
  const assetGrowth   = (sel.totalAssets[2024]-sel.totalAssets[2009]).toFixed(1);
  const gap           = Math.max(0, (assetGrowth - totalDeclared)).toFixed(1);

  const pc = PARTY_C[sel.party] || PARTY_C.IND;

  const TABS = [
    ["overview","Overview"],
    ["scoring","Score Breakdown"],
    ["network","Network"],
    ["cases","Cases"],
    ["party","Party History"],
    ["timeline","Timeline"],
  ];

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
      background:C.bg,minHeight:"100vh",color:C.ink,fontSize:13,lineHeight:1.5}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-thumb{background:#DDD;border-radius:2px;}
        .tab{background:none;border:none;border-bottom:2px solid transparent;color:${C.muted};
          padding:9px 14px;font-size:12px;font-weight:600;cursor:pointer;
          font-family:inherit;white-space:nowrap;transition:all .15s;}
        .tab.on{color:${C.ink};border-bottom-color:${C.ink};}
        .tab:hover{color:${C.ink};}
        .prow{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;
          border-bottom:1px solid ${C.border};border-left:3px solid transparent;
          transition:background .1s;}
        .prow:hover{background:#F9F9F9;}
        .prow.on{background:${C.card};border-left-color:${C.red};}
        .card{background:${C.card};border:1px solid ${C.border};border-radius:6px;padding:14px 16px;}
        .flag{display:flex;gap:10px;padding:10px 12px;margin-bottom:5px;
          background:${C.redBg};border-left:3px solid ${C.red};
          border-radius:0 4px 4px 0;font-size:12px;line-height:1.6;}
        .stat{background:${C.card};border:1px solid ${C.border};border-radius:6px;
          padding:11px 12px;text-align:center;}
        .search{width:100%;background:${C.bg};border:1px solid ${C.border};
          border-radius:4px;padding:8px 10px;font-size:12px;
          font-family:inherit;outline:none;color:${C.ink};}
        .search:focus{border-color:${C.ink};}
        .search::placeholder{color:${C.muted};}
        .btn{background:none;border:none;cursor:pointer;font-family:inherit;
          font-size:11px;font-weight:600;color:${C.blue};padding:0;}
        @media(min-width:768px){
          .layout{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 48px);}
          .sidebar{border-right:1px solid ${C.border};position:sticky;top:48px;
            height:calc(100vh - 48px);overflow-y:auto;display:flex;flex-direction:column;}
        }
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
        .g5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
        @media(max-width:767px){
          .g2{grid-template-columns:1fr!important;}
          .g5{grid-template-columns:repeat(3,1fr)!important;}
        }
        @media(max-width:480px){
          .g3{grid-template-columns:1fr 1fr;}
          .g5{grid-template-columns:1fr 1fr!important;}
        }
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      `}</style>

      {/* ── NAV ── */}
      <nav style={{background:C.ink,height:48,display:"flex",alignItems:"center",
        justifyContent:"space-between",padding:"0 16px",position:"sticky",top:0,zIndex:200}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.red,
            animation:"pulse 2s infinite"}}/>
          <span style={{color:"#fff",fontSize:16,fontWeight:800,letterSpacing:-.3}}>
            Neta<span style={{color:"#FF6B6B"}}>Watch</span>
          </span>
          <span style={{color:"#444",fontSize:10,marginLeft:4,letterSpacing:1,
            display:"none"}} className="desk">INDIA · PUBLIC DATA</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",gap:5,alignItems:"center",
            background:"#1a1a1a",padding:"3px 9px",borderRadius:3}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:"#22C55E",
              animation:"pulse 1.5s infinite"}}/>
            <span style={{fontSize:9,color:"#22C55E",letterSpacing:1,fontWeight:700}}>
              LIVE SCORES
            </span>
          </div>
          <span style={{fontSize:10,color:"#666",letterSpacing:1}}>
            {initialData.length} tracked
          </span>
        </div>
      </nav>

      <div className="layout">

        {/* ── SIDEBAR ── */}
        <aside className="sidebar" style={{background:C.card}}>
          <div style={{padding:"10px 12px 8px",borderBottom:`1px solid ${C.border}`}}>
            <input className="search" placeholder="Search name, party, state…"
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{padding:"8px 14px 4px",fontSize:10,color:C.muted,
            fontWeight:600,letterSpacing:1,textTransform:"uppercase"}}>
            {filtered.length} politician{filtered.length!==1?"s":""}
          </div>

          {filtered.map(p=>{
            const ppc = PARTY_C[p.party]||PARTY_C.IND;
            return (
              <div key={p.id} className={`prow ${selId===p.id?"on":""}`}
                onClick={()=>{setSelId(p.id);setTab("overview");setShowAllFlags(false);}}>
                <div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,
                  background:ppc.bg,border:`2px solid ${ppc.fg}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:800,color:ppc.fg}}>
                  {p.name.split(" ").map(w=>w[0]).join("")}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:1}}>
                    <span style={{color:ppc.fg,fontWeight:700}}>{p.party}</span>
                    {" · "}{p.state}
                  </div>
                  <MiniBar v={p.scoring.final} color={sc(p.scoring.final)} h={3}/>
                </div>
                <Ring score={p.scoring.final} size={44}/>
              </div>
            );
          })}

          {filtered.length===0 && (
            <div style={{padding:"24px 16px",textAlign:"center",color:C.muted,fontSize:12}}>
              No results for "{search}"
            </div>
          )}

          <div style={{marginTop:"auto",padding:"12px 14px",
            borderTop:`1px solid ${C.border}`}}>
            <p style={{fontSize:10,color:C.muted,lineHeight:1.7}}>
              Scores computed live from ECI affidavit data.<br/>
              Source: ECI · MCA21 · NJDG · Lok Sabha records.<br/>
              All information is public record.
            </p>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main style={{overflowY:"auto",background:C.bg}}>

          {/* HERO */}
          <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
            padding:"14px 16px 0"}}>

            {/* Identity row */}
            <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:C.muted,letterSpacing:1,
                  textTransform:"uppercase",marginBottom:4,fontWeight:600}}>
                  ECI Affidavit · Public Record
                </div>
                <h1 style={{fontSize:22,fontWeight:800,letterSpacing:-.4,marginBottom:6}}>
                  {sel.name}
                </h1>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
                  <Badge label={sel.party} color={pc.fg} bg={pc.bg}/>
                  <span style={{fontSize:11,color:C.dim}}>{sel.role}</span>
                </div>
                <div style={{fontSize:11,color:C.dim}}>
                  {sel.constituency} · {sel.state} · Age {sel.age}
                </div>
              </div>
              <div style={{textAlign:"center",flexShrink:0}}>
                <Ring score={scoring.final} size={68}/>
                <div style={{fontSize:9,fontWeight:700,letterSpacing:1,marginTop:3,
                  color:sc(scoring.final)}}>
                  {scoring.riskLevel}
                </div>
                <div style={{fontSize:8,color:C.muted,marginTop:1}}>COMPUTED LIVE</div>
              </div>
            </div>

            {/* Income gap alert */}
            <div style={{background:C.redBg,border:`1px solid ${C.red}33`,
              borderRadius:5,padding:"8px 12px",marginBottom:12,
              fontSize:12,color:C.red,fontWeight:600,lineHeight:1.6}}>
              ⚠ Assets grew ₹{assetGrowth}Cr since 2009.
              Declared income (on record): ₹{totalDeclared}Cr.
              Gap: ₹{gap}Cr unexplained.
            </div>

            {/* 5 key stats */}
            <div className="g5" style={{marginBottom:12}}>
              {[
                {l:"Net Worth", v:`₹${sel.totalAssets[2024]}Cr`},
                {l:"15yr Growth", v:`+${growthPct}%`, c:C.green},
                {l:"Cases", v:sel.criminalCases?.length||0,
                  c:(sel.criminalCases?.length||0)>1?C.red:C.orange},
                {l:"Switches", v:sel.partyHistory.length-1, c:"#6B21A8"},
                {l:"Flags", v:scoring.flags.length, c:C.red},
              ].map((s,i)=>(
                <div key={i} className="stat"
                  style={{borderTop:`3px solid ${s.c||C.border}`}}>
                  <div style={{fontSize:17,fontWeight:800,color:s.c||C.ink}}>{s.v}</div>
                  <div style={{fontSize:9,color:C.muted,marginTop:2,
                    textTransform:"uppercase",letterSpacing:.5}}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Auto-generated flags */}
            {scoring.flags.length>0 && (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",marginBottom:8}}>
                  <Sec>Auto-Detected Flags</Sec>
                  {scoring.flags.length>3 && (
                    <button className="btn"
                      onClick={()=>setShowAllFlags(x=>!x)}>
                      {showAllFlags?"Show less":"Show all"}
                    </button>
                  )}
                </div>
                {(showAllFlags?scoring.flags:scoring.flags.slice(0,3)).map((f,i)=>(
                  <div key={i} className="flag">
                    <span style={{color:C.red,fontWeight:800,flexShrink:0}}>#{i+1}</span>{f}
                  </div>
                ))}
              </div>
            )}

            {/* 6 sub-score tiles */}
            <div className="g3" style={{marginBottom:12}}>
              {DIMS.map((d,i)=>{
                const v=scoring.subScores[d.key];
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
            <div style={{display:"flex",overflowX:"auto",borderTop:`1px solid ${C.border}`,
              margin:"0 -16px",paddingLeft:4}}>
              {TABS.map(([k,l])=>(
                <button key={k} className={`tab ${tab===k?"on":""}`}
                  onClick={()=>setTab(k)}>{l}</button>
              ))}
            </div>
          </div>

          {/* ── TAB CONTENT ── */}
          <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>

            {/* OVERVIEW */}
            {tab==="overview" && (<>
              <div className="g2">
                <div className="card">
                  <Sec>Wealth Growth (₹ Cr)</Sec>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={assetData}>
                      <defs>
                        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.blue} stopOpacity={0.15}/>
                          <stop offset="100%" stopColor={C.blue} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="y" tick={{fill:C.muted,fontSize:10}}
                        axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.muted,fontSize:10}}
                        axisLine={false} tickLine={false}/>
                      <Tooltip content={<TT/>}/>
                      <Area dataKey="assets" name="Assets"
                        stroke={C.blue} strokeWidth={2} fill="url(#ag)"/>
                      <Area dataKey="liab" name="Liabilities"
                        stroke={C.red} strokeWidth={1.5} fill="none" strokeDasharray="4 2"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="card">
                  <Sec>Holdings & Conflicts</Sec>
                  {sel.holdings.map((h,i)=>(
                    <div key={i} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",
                        marginBottom:4,alignItems:"center"}}>
                        <span style={{fontSize:12,fontWeight:600}}>{h.sector}</span>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:12,fontWeight:700}}>₹{h.value}Cr</span>
                          <Badge label={h.conflict?"CONFLICT":"CLEAR"}
                            color={h.conflict?C.red:C.green}
                            bg={h.conflict?C.redBg:C.greenBg}/>
                        </div>
                      </div>
                      <MiniBar v={(h.value/32)*100} color={h.conflict?C.red:C.green}/>
                    </div>
                  ))}
                </div>
              </div>
            </>)}

            {/* SCORE BREAKDOWN */}
            {tab==="scoring" && (
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div className="card"
                  style={{background:C.redBg,border:`1px solid ${C.red}22`}}>
                  <div style={{display:"flex",justifyContent:"space-between",
                    alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                    <div>
                      <Sec>Final Suspicion Score</Sec>
                      <div style={{fontSize:11,color:C.dim}}>
                        Weighted average · Computed from raw affidavit data
                      </div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:44,fontWeight:900,color:sc(scoring.final),
                        lineHeight:1}}>{scoring.final}</div>
                      <div style={{fontSize:10,fontWeight:700,color:sc(scoring.final),
                        letterSpacing:1}}>{scoring.riskLevel}</div>
                    </div>
                  </div>
                  {DIMS.map((d,i)=>{
                    const raw=scoring.subScores[d.key];
                    const weight=WEIGHTS[d.key];
                    const contrib=Math.round(raw*weight);
                    return (
                      <div key={i} style={{marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",
                          marginBottom:4,flexWrap:"wrap",gap:4}}>
                          <div>
                            <span style={{fontWeight:700,fontSize:12}}>{d.label}</span>
                            <span style={{fontSize:10,color:C.muted,marginLeft:8}}>{d.desc}</span>
                          </div>
                          <div style={{display:"flex",gap:10,alignItems:"center"}}>
                            <span style={{fontSize:10,color:C.dim}}>
                              {raw} × {(weight*100).toFixed(0)}%
                            </span>
                            <span style={{fontSize:13,fontWeight:800,color:sc(raw)}}>
                              = {contrib}pts
                            </span>
                          </div>
                        </div>
                        <MiniBar v={raw} color={sc(raw)} h={6}/>
                      </div>
                    );
                  })}
                  <div style={{borderTop:`1px solid ${C.red}22`,paddingTop:12,marginTop:4,
                    display:"flex",justifyContent:"flex-end",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:C.dim}}>Total:</span>
                    <span style={{fontSize:22,fontWeight:900,color:sc(scoring.final)}}>
                      {scoring.final} / 100
                    </span>
                  </div>
                </div>
                <div className="card">
                  <Sec>How Scoring Works</Sec>
                  {[
                    ["Income Gap (25%)",     "Asset growth ÷ declared income. Ratio mapped to 0–100 curve."],
                    ["Sector Conflict (20%)","% of portfolio in sectors the minister regulates + diversity bonus."],
                    ["Trade Timing (20%)",   "Days between purchase and policy announcement. Family trades at 80% weight."],
                    ["Case Disposal (15%)",  "Cases dropped within months of party switch. ED/CBI charges get 1.2× multiplier."],
                    ["Network Risk (12%)",   "Family/associate flags × proximity weight (spouse=1.0, sibling=0.7)."],
                    ["Disclosure (8%)",      "Late filings, post-media amendments, and audit-discovered assets."],
                  ].map(([t,d],i)=>(
                    <div key={i} style={{padding:"10px 12px",background:C.bg,
                      borderRadius:5,borderLeft:`3px solid ${C.border}`,marginBottom:8}}>
                      <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>{t}</div>
                      <div style={{fontSize:11,color:C.dim}}>{d}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* NETWORK */}
            {tab==="network" && (
              <div className="card">
                <Sec>Family & Associates</Sec>
                {sel.network.map((n,i)=>{
                  const rsk=[
                    n.holdingsInConflictSectors?25:0,
                    n.tradeBeforePolicy?35:0,
                    n.govtContractWon?30:0,
                  ].reduce((a,b)=>a+b,0);
                  return (
                    <div key={i} style={{paddingBottom:14,marginBottom:14,
                      borderBottom:i<sel.network.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{display:"flex",justifyContent:"space-between",
                        alignItems:"flex-start",gap:10,marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:700,fontSize:14}}>{n.name}</div>
                          <Badge label={n.type.replace(/_/g," ").toUpperCase()}
                            color={C.dim} bg={C.bg}/>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:18,fontWeight:800,color:sc(rsk)}}>{rsk}</div>
                          <div style={{fontSize:9,color:C.muted}}>RISK PTS</div>
                        </div>
                      </div>
                      <MiniBar v={rsk} color={sc(rsk)}/>
                      <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {n.holdingsInConflictSectors &&
                          <Badge label="Conflict Holdings" color={C.red} bg={C.redBg}/>}
                        {n.tradeBeforePolicy &&
                          <Badge label="Pre-Policy Trade" color={C.red} bg={C.redBg}/>}
                        {n.govtContractWon &&
                          <Badge label={`Govt Contract ₹${n.contractValueCr||"?"}Cr`}
                            color={C.orange} bg={C.orangeBg}/>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* CASES */}
            {tab==="cases" && (
              <div className="card">
                <Sec>Criminal Cases · NJDG Record</Sec>
                {(!sel.criminalCases||sel.criminalCases.length===0) && (
                  <div style={{color:C.muted,fontSize:12,padding:"12px 0"}}>
                    No criminal cases on record.
                  </div>
                )}
                {sel.criminalCases?.map((c,i)=>(
                  <div key={i} style={{paddingBottom:14,marginBottom:14,
                    borderBottom:i<sel.criminalCases.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      alignItems:"flex-start",gap:10,marginBottom:6}}>
                      <span style={{fontWeight:700}}>{c.case}</span>
                      <Badge label={c.status}
                        color={c.status==="DROPPED"?C.red:c.status==="ACQUITTED"?C.orange:C.green}
                        bg={c.status==="DROPPED"?C.redBg:c.status==="ACQUITTED"?C.orangeBg:C.greenBg}/>
                    </div>
                    {c.resolvedYear&&(
                      <div style={{fontSize:11,color:C.dim,marginBottom:4}}>
                        Resolved: {c.resolvedYear}
                      </div>
                    )}
                    {c.note&&(
                      <div style={{fontSize:12,background:C.bg,padding:"7px 10px",
                        borderRadius:4,color:C.dim}}>{c.note}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* PARTY HISTORY */}
            {tab==="party" && (<>
              <div className="card">
                <Sec>Net Worth at Each Party Affiliation</Sec>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={sel.partyHistory.map((p,i)=>({
                    name:p.party,
                    "Net Worth":Object.values(sel.totalAssets)[i]||0,
                    fill:(PARTY_C[p.party]||PARTY_C.IND).fg,
                  }))}>
                    <XAxis dataKey="name" tick={{fill:C.dim,fontSize:11}}
                      axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:C.dim,fontSize:11}}
                      axisLine={false} tickLine={false}/>
                    <Tooltip content={<TT/>}/>
                    <Bar dataKey="Net Worth" radius={[3,3,0,0]}>
                      {sel.partyHistory.map((p,i)=>(
                        <Cell key={i} fill={(PARTY_C[p.party]||PARTY_C.IND).fg}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {sel.partyHistory.map((p,i)=>{
                const ppc2=PARTY_C[p.party]||PARTY_C.IND;
                return (
                  <div key={i} className="card"
                    style={{borderLeft:`4px solid ${ppc2.fg}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      alignItems:"center"}}>
                      <div>
                        <Badge label={p.party} color={ppc2.fg} bg={ppc2.bg}/>
                        <span style={{fontSize:11,color:C.muted,marginLeft:8}}>
                          {p.from} – {p.to}
                        </span>
                      </div>
                      <div style={{fontSize:20,fontWeight:800,color:ppc2.fg}}>
                        ₹{Object.values(sel.totalAssets)[i]||"—"}Cr
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{background:C.blueBg,border:`1px solid ${C.blue}22`,
                borderRadius:6,padding:"12px 14px",fontSize:12,
                color:C.ink,lineHeight:1.8}}>
                <strong>Pattern:</strong> {sel.name} switched parties {sel.partyHistory.length-1} time{sel.partyHistory.length>2?"s":""}. Net worth grew from ₹{sel.partyHistory[0]&&Object.values(sel.totalAssets)[0]}Cr to ₹{sel.totalAssets[2024]}Cr.
                {sel.criminalCases?.some(c=>c.note?.toLowerCase().includes("switch"))&&
                  " Criminal cases were dropped following party switches."}
              </div>
            </>)}

            {/* TIMELINE */}
            {tab==="timeline" && (
              <div className="card">
                <Sec>Activity Timeline</Sec>
                <div style={{position:"relative"}}>
                  <div style={{position:"absolute",left:36,top:0,bottom:0,
                    width:1,background:C.border}}/>
                  {sel.timeline.map((t,i)=>{
                    const color=TL_C[t.type]||C.dim;
                    return (
                      <div key={i} style={{display:"flex",marginBottom:4}}>
                        <div style={{width:36,flexShrink:0,paddingTop:3,paddingRight:10,
                          fontSize:9,color:C.muted,textAlign:"right",lineHeight:1.4}}>
                          {t.date.split(" ").map((s,j)=><div key={j}>{s}</div>)}
                        </div>
                        <div style={{flex:1,paddingLeft:16,paddingBottom:12,
                          position:"relative"}}>
                          <div style={{width:10,height:10,borderRadius:"50%",
                            border:"2px solid white",position:"absolute",left:-5,top:3,
                            background:t.flag?C.red:color,
                            boxShadow:t.flag?`0 0 0 3px ${C.redBg}`:"none"}}/>
                          <div style={{background:t.flag?C.redBg:C.bg,
                            borderRadius:5,padding:"8px 10px",
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

            {/* Footer inside content area */}
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,
              fontSize:10,color:C.muted,lineHeight:1.7,textAlign:"center"}}>
              NetaWatch uses only publicly available data from the Election Commission of India,
              Ministry of Corporate Affairs (MCA21), National Judicial Data Grid, and
              Parliamentary records. This is a transparency and public interest project.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
