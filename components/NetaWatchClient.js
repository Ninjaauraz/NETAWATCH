"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── SCORING ──────────────────────────────────────────────────────────────────
export function computeScore(p) {
  const yrs     = Object.keys(p.totalAssets || {}).sort();
  const latest  = p.totalAssets?.[yrs[yrs.length-1]] || 0;
  const first   = p.totalAssets?.[yrs[0]] || 0;
  const income  = Object.values(p.declaredIncome || {}).reduce((a,b)=>a+b,0);
  const cases   = p.criminalCases || [];
  const pending = cases.filter(c => c.status === "PENDING");
  const dropped = cases.filter(c => c.status === "DROPPED");
  const net     = p.network || [];

  // Wealth gap: how much growth vs declared income
  let wealthScore = 0;
  if (yrs.length >= 2 && income > 0) {
    const r = (latest - first) / income;
    wealthScore = r<=1?r*18 : r<=5?18+(r-1)/4*30 : r<=15?48+(r-5)/10*27 : Math.min(75+(r-15)/15*15, 96);
  } else {
    wealthScore = latest<=4.5 ? (latest/4.5)*17 : latest<=50 ? 17+(latest-4.5)/45.5*43 : Math.min(60+(latest-50)/200*36, 97);
  }

  // Cases: pending count + suspicious drops near party switches
  let caseScore = Math.min(pending.length * 12 + pending.filter(c=>/ED|CBI|murder|launder|benami/i.test(c.case||"")).length * 15, 100);
  if (dropped.length && p.partyHistory?.length > 1) {
    const switchYears = p.partyHistory.slice(1).map(x => x.from);
    dropped.forEach(d => { if (d.resolvedYear && switchYears.some(y => Math.abs(d.resolvedYear - y) <= 2)) caseScore = Math.min(caseScore + 20, 100); });
  }

  // Network: family/associates with contracts or insider trades
  const PW = { spouse:1, child:.9, sibling:.7, associate:.8, shell_company:1 };
  let netRisk = 0;
  net.forEach(n => {
    const w = PW[n.type] || .5;
    netRisk += ((n.tradeBeforePolicy?38:0) + (n.govtContractWon?32+Math.min(Math.log10(Math.max(n.contractValueCr||1,1))*6,18):0) + (n.holdingsInConflictSectors?20:0)) * w;
  });
  const networkScore = Math.min((netRisk / Math.max(net.length, 1) / 100) * 150, 100);

  // Trade timing
  const trades = p.tradeEvents || [];
  const tradeScore = !trades.length ? 0 : Math.min(
    trades.map(e => { const d=(new Date(e.policyDate)-new Date(e.date))/86400000; return d<=0?0:d<=30?92:d<=90?68:d<=180?38:14; })
      .sort((a,b)=>b-a).reduce((s,v,i)=>s+(i===0?v:v*.25),0), 100);

  // Disclosure failures
  const disc = p.disclosure || {};
  const discScore = Math.min((disc.lateFilings||0)*8+(disc.amendmentsAfterMedia||0)*18+(disc.assetsFoundInAudit||0)*28+(disc.missingYears||0)*22, 100);

  const final = Math.round(wealthScore*.28 + caseScore*.22 + networkScore*.18 + tradeScore*.16 + discScore*.10 + Math.min((p.holdings||[]).filter(h=>h.conflict).length*16,100)*.06);
  const tier  = final>=80?"CRITICAL":final>=60?"HIGH":final>=38?"ELEVATED":final>=18?"LOW":"CLEAR";

  return { final, tier, wealthScore:Math.round(wealthScore), caseScore, networkScore:Math.round(networkScore), tradeScore:Math.round(tradeScore), discScore, netWorth:latest, pendingCases:pending.length, unexplained:Math.max(0,latest-4.5) };
}

export function scoreBatch(arr) {
  return arr.map(p => ({ ...p, _score: computeScore(p) })).sort((a,b) => b._score.final - a._score.final);
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const BG    = "#0f0900";
const AMBER = "#ffb340";
const DIM   = "#5a3e1b";
const MID   = "#a06820";
const GLOW  = "rgba(255,179,64,0.12)";

const TIER_STYLE = {
  CRITICAL: { color:"#ff453a", glow:"rgba(255,69,58,0.25)",  label:"CRITICAL"  },
  HIGH:     { color:"#ff9f0a", glow:"rgba(255,159,10,0.2)",  label:"HIGH RISK" },
  ELEVATED: { color:"#ffd60a", glow:"rgba(255,214,10,0.18)", label:"ELEVATED"  },
  LOW:      { color:"#32d74b", glow:"rgba(50,215,75,0.15)",  label:"LOW RISK"  },
  CLEAR:    { color:"#0a84ff", glow:"rgba(10,132,255,0.15)", label:"CLEAR"     },
};

const PARTY_COLORS = {
  BJP:"#ff6b35", INC:"#4a9eff", TMC:"#00d4aa", AAP:"#00c8ff",
  NCP:"#c77dff", SP:"#ff4d6d", BSP:"#4361ee", DMK:"#e63946", IND:"#8d8d8d",
};
const pColor = p => PARTY_COLORS[p?.toUpperCase()] || "#8d8d8d";

// ─── WAVEFORM GENERATOR ───────────────────────────────────────────────────────
// Generates a deterministic SVG waveform path for a politician's signal
function generateWaveform(score, seed, width=200, height=32) {
  const pts = [];
  let x = seed * 137.508; // golden angle offset for variety
  for (let i = 0; i <= width; i += 4) {
    const noise = Math.sin(i * 0.08 + x) * 0.5 + Math.sin(i * 0.19 + x*1.3) * 0.3 + Math.sin(i * 0.41 + x*0.7) * 0.2;
    const amp = (score / 100) * (height * 0.42);
    const y = height/2 - noise * amp;
    pts.push(`${i},${y.toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
}

// ─── RADIAL EVIDENCE DIAGRAM (Canvas-drawn) ───────────────────────────────────
function RadialDiagram({ politician, width, height }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const phaseRef  = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !politician) return;
    const ctx    = canvas.getContext("2d");
    const W = width, H = height;
    const cx = W * 0.38, cy = H * 0.5;
    const p  = politician;
    const sc = p._score;

    // Build radial segments from data
    const segments = [];

    // Wealth arc (bottom-left)
    const wYrs = Object.keys(p.totalAssets || {}).sort();
    if (wYrs.length >= 2) {
      wYrs.forEach((yr, i) => {
        const val = p.totalAssets[yr];
        const maxVal = Math.max(...Object.values(p.totalAssets));
        segments.push({ label: yr, value: val/maxVal, type:"wealth", color:"#ffb340", angle: -Math.PI*0.9 + i*(Math.PI*0.35) });
      });
    }

    // Cases (top-right)
    (p.criminalCases || []).forEach((c, i) => {
      const color = c.status==="PENDING"?"#ff453a":c.status==="DROPPED"?"#ff9f0a":"#32d74b";
      segments.push({ label: c.case.slice(0,20), value: 0.6 + (i*0.08), type:"case", color, angle: Math.PI*0.05 + i*(Math.PI*0.22) });
    });

    // Network (right)
    (p.network || []).forEach((n, i) => {
      const risk = (n.tradeBeforePolicy?0.4:0) + (n.govtContractWon?0.5:0) + (n.holdingsInConflictSectors?0.3:0);
      segments.push({ label: n.name.split(" ")[0], value: Math.min(risk, 1), type:"network", color:"#c77dff", angle: -Math.PI*0.25 + i*(Math.PI*0.28) });
    });

    // Party history (bottom)
    (p.partyHistory || []).forEach((ph, i) => {
      segments.push({ label: ph.party, value: 0.45, type:"party", color: pColor(ph.party), angle: Math.PI*0.55 + i*(Math.PI*0.25) });
    });

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      phaseRef.current += 0.008;
      const phase = phaseRef.current;

      // Background subtle grid
      ctx.strokeStyle = "rgba(255,179,64,0.04)";
      ctx.lineWidth = 1;
      for (let r = 40; r < Math.max(W,H); r += 60) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      }

      // Center pulse rings
      const pulseR = 24 + Math.sin(phase*2)*4;
      const grad = ctx.createRadialGradient(cx,cy,0,cx,cy,pulseR*2);
      grad.addColorStop(0, TIER_STYLE[sc.tier].glow.replace("0.25","0.6"));
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx,cy,pulseR*2,0,Math.PI*2); ctx.fill();

      ctx.strokeStyle = TIER_STYLE[sc.tier].color;
      ctx.lineWidth = 2;
      ctx.shadowColor = TIER_STYLE[sc.tier].color;
      ctx.shadowBlur  = 12;
      ctx.beginPath(); ctx.arc(cx,cy,pulseR,0,Math.PI*2); ctx.stroke();
      ctx.shadowBlur = 0;

      // Score number at center
      ctx.fillStyle = TIER_STYLE[sc.tier].color;
      ctx.font = `700 ${Math.round(pulseR*1.1)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = TIER_STYLE[sc.tier].color;
      ctx.shadowBlur  = 20;
      ctx.fillText(sc.final, cx, cy);
      ctx.shadowBlur = 0;

      // Radial arms
      segments.forEach((seg, i) => {
        const angle     = seg.angle + Math.sin(phase + i*0.5)*0.025; // gentle breathing
        const baseR     = 55;
        const maxR      = Math.min(W, H) * 0.38;
        const armLen    = baseR + seg.value * (maxR - baseR);
        const wobble    = Math.sin(phase*1.3 + i*1.1) * 3;
        const ex        = cx + Math.cos(angle) * (armLen + wobble);
        const ey        = cy + Math.sin(angle) * (armLen + wobble);
        const mx        = cx + Math.cos(angle) * (armLen*0.5);
        const my        = cy + Math.sin(angle) * (armLen*0.5);
        const cpx       = mx + Math.cos(angle + Math.PI/2) * (armLen*0.15);
        const cpy       = my + Math.sin(angle + Math.PI/2) * (armLen*0.15);

        // Arm line (curved)
        const alpha = 0.35 + seg.value * 0.4 + Math.sin(phase + i)*0.1;
        ctx.strokeStyle = seg.color + Math.round(alpha*255).toString(16).padStart(2,"0");
        ctx.lineWidth   = 1.2 + seg.value;
        ctx.shadowColor = seg.color;
        ctx.shadowBlur  = seg.type==="case"?8:4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle)*baseR, cy + Math.sin(angle)*baseR);
        ctx.quadraticCurveTo(cpx,cpy,ex,ey);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // End node
        const nodeR = 3.5 + seg.value * 5 + Math.sin(phase*1.8+i)*1.2;
        ctx.fillStyle = seg.color + "cc";
        ctx.shadowColor = seg.color;
        ctx.shadowBlur  = 10;
        ctx.beginPath(); ctx.arc(ex,ey,nodeR,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        const labelDist = armLen + nodeR + 14;
        const lx = cx + Math.cos(angle) * labelDist;
        const ly = cy + Math.sin(angle) * labelDist;
        ctx.fillStyle = seg.color + "bb";
        ctx.font = `10px 'IBM Plex Mono', monospace`;
        ctx.textAlign = Math.cos(angle) > 0 ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(seg.label, lx, ly);
      });

      // Connection threads between related segments
      for (let i = 0; i < segments.length; i++) {
        for (let j = i+1; j < segments.length; j++) {
          const a = segments[i], b = segments[j];
          if (a.type === b.type && a.type === "case") {
            const aR = 55 + a.value*(Math.min(W,H)*0.38-55);
            const bR = 55 + b.value*(Math.min(W,H)*0.38-55);
            const ax = cx + Math.cos(a.angle)*aR, ay = cy + Math.sin(a.angle)*aR;
            const bx = cx + Math.cos(b.angle)*bR, by = cy + Math.sin(b.angle)*bR;
            ctx.strokeStyle = "rgba(255,69,58,0.08)";
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
          }
        }
      }

      // Right panel: stats flowing out
      const statX = cx + Math.min(W,H)*0.48;
      const stats = [
        { label:"NET WORTH",   value:`₹${sc.netWorth}Cr`,          color: sc.netWorth>50?"#ff453a":AMBER },
        { label:"UNEXPLAINED", value:`₹${sc.unexplained.toFixed(1)}Cr`, color: sc.unexplained>20?"#ff453a":MID },
        { label:"PENDING",     value:`${sc.pendingCases} cases`,    color: sc.pendingCases>2?"#ff453a":sc.pendingCases>0?"#ff9f0a":"#32d74b" },
        { label:"PARTY HIST.", value:`${(p.partyHistory||[]).length} parties`, color: (p.partyHistory||[]).length>2?"#ff9f0a":MID },
      ];
      stats.forEach((s, i) => {
        const y = cy - 44 + i * 30;
        ctx.fillStyle = "rgba(15,9,0,0.7)";
        ctx.fillRect(statX - 4, y - 10, 175, 24);
        ctx.fillStyle = s.color + "33";
        ctx.fillRect(statX - 4, y - 10, 4, 24);
        ctx.fillStyle = DIM;
        ctx.font = "8px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(s.label, statX + 6, y - 1);
        ctx.fillStyle = s.color;
        ctx.font = "700 12px 'IBM Plex Mono', monospace";
        ctx.fillText(s.value, statX + 6, y + 11);
      });

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [politician, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ display:"block" }}/>;
}

// ─── SIGNAL LINE (waveform per politician in the list) ────────────────────────
function SignalLine({ p, selected, onClick, flashLevel }) {
  const sc     = p._score;
  const ts     = TIER_STYLE[sc.tier];
  const pc     = pColor(p.party);
  const wavePath = useMemo(() => generateWaveform(sc.final, parseInt(p.id||"1")), [sc.final, p.id]);
  const [hovered, setHovered] = useState(false);

  const isLit = flashLevel > 0 || selected || hovered;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:"10px 16px 10px 20px",
        cursor:"pointer",
        position:"relative",
        transition:"background 0.3s",
        background: selected ? "rgba(255,179,64,0.06)" : hovered ? "rgba(255,179,64,0.03)" : "transparent",
        borderBottom: `1px solid rgba(255,179,64,0.04)`,
        borderLeft: `2px solid ${selected ? ts.color : flashLevel>0 ? ts.color+"aa" : "transparent"}`,
      }}
    >
      {/* Flash overlay */}
      {flashLevel > 0 && (
        <div style={{
          position:"absolute", inset:0, pointerEvents:"none",
          background:`linear-gradient(90deg, ${ts.glow} 0%, transparent 70%)`,
          animation:"nw-flash 2s ease-out forwards",
        }}/>
      )}

      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        {/* Name + party */}
        <div style={{ width:170, flexShrink:0 }}>
          <div style={{
            fontSize:12.5, fontWeight:600, color: isLit ? "#f5d9a0" : "#9a7040",
            fontFamily:"'DM Serif Display', serif",
            letterSpacing:.2, lineHeight:1.2,
            transition:"color .3s",
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
          }}>{p.name}</div>
          <div style={{ display:"flex", gap:5, marginTop:3, alignItems:"center" }}>
            <span style={{ fontSize:8, fontWeight:700, color:pc, letterSpacing:1.5,
              fontFamily:"'IBM Plex Mono', monospace", opacity:.9 }}>{p.party}</span>
            {p.chamber==="RS" && <span style={{ fontSize:7, color:DIM, fontFamily:"'IBM Plex Mono', monospace", letterSpacing:1 }}>RS</span>}
            {sc.pendingCases > 0 && (
              <span style={{ fontSize:7, color:TIER_STYLE.CRITICAL.color, fontFamily:"'IBM Plex Mono', monospace",
                animation:"nw-blink 1.4s infinite", letterSpacing:1 }}>
                ⬤ {sc.pendingCases}
              </span>
            )}
          </div>
        </div>

        {/* Signal waveform */}
        <div style={{ flex:1, position:"relative", height:32, overflow:"hidden" }}>
          <svg width="100%" height="32" preserveAspectRatio="none" viewBox={`0 0 200 32`}>
            <defs>
              <linearGradient id={`wg${p.id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={ts.color} stopOpacity="0"/>
                <stop offset="30%" stopColor={ts.color} stopOpacity={isLit?"0.9":"0.25"}/>
                <stop offset="100%" stopColor={ts.color} stopOpacity={isLit?"0.5":"0.1"}/>
              </linearGradient>
              <filter id={`wf${p.id}`}><feGaussianBlur stdDeviation="0.8"/></filter>
            </defs>
            {/* Glow duplicate */}
            {isLit && <path d={wavePath} stroke={ts.color} strokeWidth="3" fill="none" opacity="0.15" filter={`url(#wf${p.id})`}/>}
            <path d={wavePath} stroke={`url(#wg${p.id})`} strokeWidth={selected?1.8:1.2} fill="none"/>
          </svg>
        </div>

        {/* Score */}
        <div style={{ width:38, textAlign:"right", flexShrink:0 }}>
          <div style={{
            fontSize:18, fontWeight:700, color: ts.color,
            fontFamily:"'IBM Plex Mono', monospace",
            lineHeight:1, letterSpacing:-1,
            textShadow: isLit ? `0 0 16px ${ts.color}` : "none",
            transition:"text-shadow .3s",
          }}>{sc.final}</div>
        </div>
      </div>
    </div>
  );
}

// ─── TIMELINE STRIP ───────────────────────────────────────────────────────────
function TimelineStrip({ events }) {
  if (!events?.length) return null;
  const typeColor = { party:"#c77dff", legal:"#ff453a", appt:"#4a9eff",
    trade:"#ff9f0a", policy:"#5a3e1b", gain:"#32d74b", contract:"#ff453a" };
  return (
    <div style={{ position:"relative", overflowX:"auto", paddingBottom:4 }}>
      <div style={{ display:"flex", gap:0, minWidth:"max-content", position:"relative" }}>
        {/* Connecting line */}
        <div style={{ position:"absolute", top:12, left:8, right:8, height:1,
          background:"linear-gradient(to right, transparent, rgba(255,179,64,0.15), transparent)" }}/>
        {events.map((ev, i) => {
          const c = typeColor[ev.type] || DIM;
          return (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center",
              gap:6, padding:"0 10px", cursor:"default", position:"relative" }}>
              <div style={{
                width:10, height:10, borderRadius:"50%", flexShrink:0, zIndex:1,
                background: ev.flag ? c : "transparent",
                border:`1.5px solid ${c}`,
                boxShadow: ev.flag ? `0 0 8px ${c}` : "none",
              }}/>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <span style={{ fontSize:8, color:DIM, fontFamily:"'IBM Plex Mono', monospace",
                  letterSpacing:.5, whiteSpace:"nowrap" }}>{ev.date}</span>
                <span style={{ fontSize:9, color: ev.flag ? "#f5d9a0" : "#5a3e1b",
                  fontFamily:"'DM Serif Display', serif", maxWidth:90,
                  textAlign:"center", lineHeight:1.3 }}>{ev.event}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LIVE NEWS FEED ───────────────────────────────────────────────────────────
function LiveNews({ newsItems }) {
  if (!newsItems?.length) return (
    <div style={{ padding:"12px 0", fontFamily:"'IBM Plex Mono', monospace",
      fontSize:9, color:DIM, letterSpacing:1 }}>AWAITING SIGNAL…</div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {newsItems.map((n, i) => (
        <a key={i} href={n.link} target="_blank" rel="noreferrer"
          style={{ textDecoration:"none", display:"block", padding:"9px 11px",
            background: n.isCourt ? "rgba(255,69,58,0.06)" : "rgba(255,179,64,0.04)",
            borderLeft:`2px solid ${n.isCourt?"#ff453a":AMBER+"44"}`,
            borderRadius:"0 4px 4px 0",
          }}>
          <div style={{ fontSize:11, color: n.isCourt ? "#ffb8b0" : "#c4a060",
            fontFamily:"'DM Serif Display', serif", lineHeight:1.45, marginBottom:3 }}>
            {n.isCourt && <span style={{ color:"#ff453a", fontSize:8,
              fontFamily:"'IBM Plex Mono', monospace", letterSpacing:1, marginRight:5 }}>COURT</span>}
            {n.title}
          </div>
          <div style={{ fontSize:8, color:DIM, fontFamily:"'IBM Plex Mono', monospace", letterSpacing:.5 }}>
            {n.src} · {n.date}
          </div>
        </a>
      ))}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  // Font injection
  useEffect(() => {
    if (document.getElementById("nw-fonts")) return;
    const l = document.createElement("link");
    l.id = "nw-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;600;700&display=swap";
    document.head.appendChild(l);
  }, []);

  const [pols,      setPols]     = useState(initialData);
  const [selected,  setSelected] = useState(initialData[0]?.id || null);
  const [query,     setQuery]    = useState("");
  const [sortBy,    setSortBy]   = useState("score");
  const [connected, setConn]     = useState(false);
  const [flashes,   setFlashes]  = useState({}); // id -> flash intensity
  const [newsMap,   setNewsMap]  = useState({}); // id -> news[]
  const [liveCount, setLC]       = useState(0);
  const [diagSize,  setDiagSize] = useState({ w:0, h:0 });
  const rightRef = useRef(null);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-IN",{hour12:false}));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, []);

  // Measure right panel for canvas
  useEffect(() => {
    if (!rightRef.current) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      setDiagSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height * 0.52) });
    });
    ro.observe(rightRef.current);
    return () => ro.disconnect();
  }, []);

  // SSE connection
  useEffect(() => {
    let src;
    const connect = () => {
      src = new EventSource("/api/stream");
      src.addEventListener("init", e => {
        const d = JSON.parse(e.data);
        setPols(d.politicians);
        setConn(true);
      });
      src.addEventListener("news", e => {
        const { id, news } = JSON.parse(e.data);
        setNewsMap(m => ({ ...m, [id]: news }));
        setFlashes(f => ({ ...f, [id]: Date.now() }));
        setLC(n => n + 1);
      });
      src.addEventListener("heartbeat", () => setConn(true));
      src.onerror = () => { setConn(false); src.close(); setTimeout(connect, 5000); };
    };
    connect();
    return () => src?.close();
  }, []);

  const sorted = useMemo(() => {
    const arr = [...pols];
    if (sortBy==="score")  arr.sort((a,b)=>b._score.final-a._score.final);
    if (sortBy==="wealth") arr.sort((a,b)=>(b._score?.netWorth||0)-(a._score?.netWorth||0));
    if (sortBy==="cases")  arr.sort((a,b)=>(b._score?.pendingCases||0)-(a._score?.pendingCases||0));
    if (sortBy==="name")   arr.sort((a,b)=>a.name.localeCompare(b.name));
    return arr;
  }, [pols, sortBy]);

  const filtered = useMemo(() => {
    if (!query) return sorted;
    const q = query.toLowerCase();
    return sorted.filter(p => `${p.name} ${p.party} ${p.state} ${p.constituency}`.toLowerCase().includes(q));
  }, [sorted, query]);

  const selPol = pols.find(p => p.id === selected) || pols[0];
  const selNews = selPol ? (newsMap[selPol.id] || selPol._liveNews || []) : [];
  const selScore = selPol?._score;
  const selTier  = selScore ? TIER_STYLE[selScore.tier] : TIER_STYLE.CLEAR;

  // Stats
  const stats = useMemo(() => ({
    total:    pols.length,
    critical: pols.filter(p=>p._score?.tier==="CRITICAL").length,
    cases:    pols.reduce((s,p)=>s+(p._score?.pendingCases||0),0),
    wealth:   Math.round(pols.reduce((s,p)=>s+(p._score?.netWorth||0),0)),
  }), [pols]);

  // Ticker
  const [tickX, setTickX] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTickX(x => x - 1), 28);
    return () => clearInterval(t);
  }, []);
  const tickText = sorted.slice(0,12).map(p=>`${p.name}  ${p._score?.final||0}`).join("  ·  ") + "  ·  ";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden",
      background:BG, color:AMBER, fontFamily:"'IBM Plex Mono', monospace",
      // Noise texture overlay
      backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
    }}>

      <style>{`
        @keyframes nw-flash  { 0%{opacity:1} 100%{opacity:0} }
        @keyframes nw-blink  { 0%,100%{opacity:1} 50%{opacity:0.15} }
        @keyframes nw-pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
        @keyframes nw-slidein{ from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:none} }
        @keyframes nw-fadein { from{opacity:0} to{opacity:1} }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,179,64,0.12); border-radius:2px; }
        input::placeholder { color:${DIM}; }
        a { color:inherit; text-decoration:none; }
        .nw-sort { background:none; border:1px solid ${DIM}44; border-radius:3px; padding:3px 8px;
          font-family:'IBM Plex Mono',monospace; font-size:9px; color:${DIM}; cursor:pointer;
          letter-spacing:1px; transition:all .15s; }
        .nw-sort:hover { border-color:${AMBER}44; color:${AMBER}88; }
        .nw-sort.on { border-color:${AMBER}66; color:${AMBER}; background:rgba(255,179,64,0.08); }
      `}</style>

      {/* ── TICKER ── */}
      <div style={{ height:18, overflow:"hidden", background:"rgba(0,0,0,0.4)",
        borderBottom:`1px solid rgba(255,179,64,0.06)`, position:"relative", flexShrink:0 }}>
        <div style={{ position:"absolute", inset:0,
          backgroundImage:"repeating-linear-gradient(90deg,rgba(255,179,64,0.03) 0,rgba(255,179,64,0.03) 1px,transparent 1px,transparent 60px)",
          pointerEvents:"none" }}/>
        <div style={{ position:"absolute", left:0, top:0, bottom:0, width:40,
          background:`linear-gradient(to right, ${BG}, transparent)`, zIndex:1, pointerEvents:"none" }}/>
        <div style={{ position:"absolute", right:0, top:0, bottom:0, width:40,
          background:`linear-gradient(to left, ${BG}, transparent)`, zIndex:1, pointerEvents:"none" }}/>
        <div style={{ position:"absolute", top:"50%", transform:"translateY(-50%)",
          left:tickX % (tickText.length * 7.5), whiteSpace:"nowrap",
          fontSize:9, color:DIM, letterSpacing:2, fontFamily:"'IBM Plex Mono', monospace" }}>
          {tickText}{tickText}
        </div>
      </div>

      {/* ── TOP BAR ── */}
      <div style={{ display:"flex", alignItems:"center", gap:16, padding:"0 20px",
        height:42, borderBottom:`1px solid rgba(255,179,64,0.07)`,
        background:"rgba(0,0,0,0.3)", flexShrink:0, backdropFilter:"blur(4px)" }}>

        {/* Logo */}
        <div style={{ display:"flex", alignItems:"baseline", gap:6, flexShrink:0 }}>
          <span style={{ fontFamily:"'DM Serif Display', serif", fontSize:20, color:"#f5d9a0",
            letterSpacing:-.5, fontStyle:"italic" }}>Neta</span>
          <span style={{ fontFamily:"'DM Serif Display', serif", fontSize:20, color:AMBER,
            letterSpacing:-.5 }}>Watch</span>
          <span style={{ fontSize:8, color:DIM, letterSpacing:3, marginLeft:4 }}>INDIA</span>
        </div>

        <div style={{ width:1, height:16, background:DIM+"44", flexShrink:0 }}/>

        {/* Live indicator */}
        <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
          <div style={{ width:5, height:5, borderRadius:"50%",
            background:connected?"#32d74b":"#ff453a",
            boxShadow:`0 0 ${connected?"8px #32d74b":"6px #ff453a"}`,
            animation: connected ? "nw-pulse 2.5s infinite" : "nw-blink 1s infinite" }}/>
          <span style={{ fontSize:8, color:connected?"#32d74b88":"#ff453a88", letterSpacing:2 }}>
            {connected?"LIVE":"RECONNECTING"}
          </span>
          {liveCount > 0 && <span style={{ fontSize:8, color:DIM, letterSpacing:1 }}>{liveCount} UPDATES</span>}
        </div>

        {/* Search */}
        <div style={{ flex:1, maxWidth:320, position:"relative" }}>
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)",
            fontSize:11, color:DIM, pointerEvents:"none" }}>⌕</span>
          <input value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="search subjects…"
            style={{ width:"100%", background:"rgba(255,179,64,0.04)", border:`1px solid ${DIM}33`,
              borderRadius:5, padding:"5px 9px 5px 24px", fontSize:9, color:AMBER,
              letterSpacing:.5, outline:"none", fontFamily:"'IBM Plex Mono', monospace" }}/>
        </div>

        {/* Sort */}
        <div style={{ display:"flex", gap:4, flexShrink:0 }}>
          {[["score","SCORE"],["wealth","WEALTH"],["cases","CASES"],["name","NAME"]].map(([k,l])=>(
            <button key={k} className={`nw-sort ${sortBy===k?"on":""}`} onClick={()=>setSortBy(k)}>{l}</button>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display:"flex", gap:14, flexShrink:0, alignItems:"center" }}>
          {[
            [stats.total,"SUBJECTS","#5a3e1b"],
            [stats.critical,"CRITICAL","#ff453a"],
            [stats.cases,"CASES","#ff9f0a"],
          ].map(([v,l,c])=>(
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:700, color:c, lineHeight:1, letterSpacing:-1 }}>{v}</div>
              <div style={{ fontSize:7, color:DIM, letterSpacing:2, marginTop:1 }}>{l}</div>
            </div>
          ))}
          <div style={{ fontSize:8, color:DIM+"66", letterSpacing:1, marginLeft:4 }}>{clock}</div>
        </div>
      </div>

      {/* ── BODY: LEFT LIST + RIGHT DETAIL ── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>

        {/* ── LEFT: SIGNAL LIST ── */}
        <div style={{ width:350, flexShrink:0, borderRight:`1px solid rgba(255,179,64,0.07)`,
          display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* Column headers */}
          <div style={{ display:"flex", alignItems:"center", padding:"7px 20px",
            borderBottom:`1px solid rgba(255,179,64,0.05)`,
            background:"rgba(0,0,0,0.25)", flexShrink:0 }}>
            <span style={{ fontSize:7, color:DIM, letterSpacing:3, flex:1 }}>SUBJECT</span>
            <span style={{ fontSize:7, color:DIM, letterSpacing:3, width:80, textAlign:"center" }}>SIGNAL</span>
            <span style={{ fontSize:7, color:DIM, letterSpacing:3, width:38, textAlign:"right" }}>IDX</span>
          </div>

          {/* Scrollable signal list */}
          <div style={{ flex:1, overflowY:"auto" }}>
            {filtered.map((p, i) => (
              <div key={p.id} style={{ animationDelay:`${i*0.015}s`, animation:"nw-fadein .3s ease both" }}>
                <SignalLine
                  p={p}
                  selected={p.id === selected}
                  onClick={() => setSelected(p.id)}
                  flashLevel={flashes[p.id] && Date.now()-flashes[p.id] < 2200 ? 1 : 0}
                />
              </div>
            ))}
            {!filtered.length && (
              <div style={{ padding:"32px 20px", textAlign:"center", fontSize:9, color:DIM, letterSpacing:2 }}>
                NO SIGNAL FOUND
              </div>
            )}
          </div>

          {/* Bottom stats */}
          <div style={{ padding:"10px 16px", borderTop:`1px solid rgba(255,179,64,0.06)`,
            display:"flex", gap:16, flexShrink:0, background:"rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize:7, color:DIM, letterSpacing:1 }}>
              {filtered.length} / {pols.length} subjects
            </div>
            <div style={{ fontSize:7, color:DIM, letterSpacing:1, marginLeft:"auto" }}>
              ₹{stats.wealth}Cr total declared
            </div>
          </div>
        </div>

        {/* ── RIGHT: DETAIL PANEL ── */}
        {selPol && (
          <div key={selPol.id} ref={rightRef}
            style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column",
              animation:"nw-slidein .22s ease" }}>

            {/* Header */}
            <div style={{ padding:"24px 28px 16px",
              borderBottom:`1px solid rgba(255,179,64,0.06)`,
              background:"rgba(0,0,0,0.2)", flexShrink:0 }}>
              <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:8, color:DIM, letterSpacing:3, marginBottom:6, textTransform:"uppercase" }}>
                    {selPol.chamber==="RS"?"Rajya Sabha":"Lok Sabha"} · {selPol.state}
                  </div>
                  <h1 style={{ fontFamily:"'DM Serif Display', serif", fontSize:32, color:"#f5d9a0",
                    fontWeight:400, letterSpacing:-.5, lineHeight:1.1, marginBottom:8 }}>
                    {selPol.name}
                  </h1>
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                    <span style={{ fontSize:9, fontWeight:700, color:pColor(selPol.party),
                      letterSpacing:2, border:`1px solid ${pColor(selPol.party)}33`,
                      padding:"2px 8px", borderRadius:3 }}>{selPol.party}</span>
                    <span style={{ fontSize:9, color:DIM }}>{selPol.role}</span>
                    {selPol.constituency && <span style={{ fontSize:9, color:DIM }}>{selPol.constituency}</span>}
                  </div>
                </div>

                {/* Tier badge */}
                <div style={{ textAlign:"center", flexShrink:0, padding:"12px 20px",
                  border:`1px solid ${selTier.color}33`, borderRadius:6,
                  background:`${selTier.glow}`, backdropFilter:"blur(4px)" }}>
                  <div style={{ fontSize:48, fontWeight:700, color:selTier.color,
                    fontFamily:"'IBM Plex Mono', monospace", lineHeight:1, letterSpacing:-2,
                    textShadow:`0 0 40px ${selTier.color}` }}>{selScore.final}</div>
                  <div style={{ fontSize:8, color:selTier.color+"aa", letterSpacing:3,
                    marginTop:4, textTransform:"uppercase" }}>{selTier.label}</div>
                  <div style={{ fontSize:7, color:DIM, letterSpacing:2, marginTop:2 }}>CORRUPTION INDEX</div>
                </div>
              </div>

              {/* Sub-score bars */}
              <div style={{ display:"flex", gap:12, marginTop:16, flexWrap:"wrap" }}>
                {[
                  ["WEALTH", selScore.wealthScore],
                  ["CASES",  selScore.caseScore],
                  ["NETWORK",selScore.networkScore],
                  ["TRADES", selScore.tradeScore],
                  ["DISCLOSE",selScore.discScore],
                ].map(([l,v])=>{
                  const c = v>65?"#ff453a":v>38?"#ff9f0a":v>18?"#ffd60a":"#32d74b";
                  return (
                    <div key={l} style={{ flex:"1 1 80px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ fontSize:7, color:DIM, letterSpacing:1.5 }}>{l}</span>
                        <span style={{ fontSize:7, color:c, fontWeight:700 }}>{v}</span>
                      </div>
                      <div style={{ height:2, background:"rgba(255,179,64,0.08)", borderRadius:1, overflow:"hidden" }}>
                        <div style={{ width:`${v}%`, height:"100%", background:c, borderRadius:1, transition:"width .7s ease" }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Radial diagram */}
            {diagSize.w > 0 && (
              <div style={{ flexShrink:0, padding:"4px 0",
                borderBottom:`1px solid rgba(255,179,64,0.05)` }}>
                <RadialDiagram politician={selPol} width={diagSize.w} height={Math.max(diagSize.h, 260)}/>
              </div>
            )}

            {/* Content grid */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0,
              flex:1, minHeight:0 }}>

              {/* Timeline */}
              <div style={{ padding:"16px 20px", borderRight:`1px solid rgba(255,179,64,0.05)`,
                borderBottom:`1px solid rgba(255,179,64,0.05)` }}>
                <div style={{ fontSize:8, color:DIM, letterSpacing:3, marginBottom:12,
                  textTransform:"uppercase" }}>Evidence Timeline</div>
                {selPol.timeline?.length
                  ? <TimelineStrip events={selPol.timeline}/>
                  : <div style={{ fontSize:9, color:DIM+"66", fontStyle:"italic" }}>No timeline on file</div>}
              </div>

              {/* Live news */}
              <div style={{ padding:"16px 20px", borderBottom:`1px solid rgba(255,179,64,0.05)` }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>
                  {connected && selNews.length > 0 && (
                    <div style={{ width:5, height:5, borderRadius:"50%", background:"#32d74b",
                      animation:"nw-pulse 2s infinite", flexShrink:0 }}/>
                  )}
                  <div style={{ fontSize:8, color:DIM, letterSpacing:3, textTransform:"uppercase" }}>
                    Live Intelligence
                  </div>
                </div>
                <LiveNews newsItems={selNews}/>
              </div>

              {/* Network */}
              <div style={{ padding:"16px 20px", borderRight:`1px solid rgba(255,179,64,0.05)` }}>
                <div style={{ fontSize:8, color:DIM, letterSpacing:3, marginBottom:12,
                  textTransform:"uppercase" }}>Network</div>
                {selPol.network?.length ? selPol.network.map((n,i) => {
                  const risk = ((n.tradeBeforePolicy?38:0)+(n.govtContractWon?35:0)+(n.holdingsInConflictSectors?22:0));
                  const c    = risk>55?"#ff453a":risk>30?"#ff9f0a":DIM;
                  return (
                    <div key={i} style={{ marginBottom:8, padding:"8px 10px",
                      background:"rgba(255,179,64,0.025)", borderLeft:`2px solid ${c}44`,
                      borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:11, color:"#c4a060",
                        fontFamily:"'DM Serif Display', serif", marginBottom:2 }}>{n.name}</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        <span style={{ fontSize:8, color:DIM, letterSpacing:1, border:`1px solid ${DIM}33`,
                          padding:"1px 5px", borderRadius:2 }}>{n.type.replace(/_/g," ")}</span>
                        {n.govtContractWon && <span style={{ fontSize:8, color:"#ff9f0a", letterSpacing:1 }}>
                          ₹{n.contractValueCr}Cr contract</span>}
                        {n.tradeBeforePolicy && <span style={{ fontSize:8, color:"#ff453a", letterSpacing:1 }}>insider trade</span>}
                      </div>
                    </div>
                  );
                }) : <div style={{ fontSize:9, color:DIM+"66" }}>—</div>}
              </div>

              {/* Criminal cases */}
              <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:8, color:DIM, letterSpacing:3, marginBottom:12,
                  textTransform:"uppercase" }}>Criminal Cases</div>
                {selPol.criminalCases?.length ? selPol.criminalCases.map((c,i) => {
                  const sc = c.status==="PENDING"?"#ff453a":c.status==="DROPPED"?"#ff9f0a":"#32d74b";
                  return (
                    <div key={i} style={{ marginBottom:8, padding:"8px 10px",
                      background: c.status==="PENDING"?"rgba(255,69,58,0.05)":"rgba(255,179,64,0.02)",
                      borderLeft:`2px solid ${sc}55`, borderRadius:"0 4px 4px 0" }}>
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                        {c.status==="PENDING" && <span style={{ width:5,height:5,borderRadius:"50%",
                          background:"#ff453a",flexShrink:0,animation:"nw-blink 1.4s infinite" }}/>}
                        <span style={{ fontSize:8, color:sc, letterSpacing:2, fontFamily:"'IBM Plex Mono', monospace" }}>{c.status}</span>
                      </div>
                      <div style={{ fontSize:11, color:"#c4a060",
                        fontFamily:"'DM Serif Display', serif", lineHeight:1.4 }}>{c.case}</div>
                      {c.note && <div style={{ fontSize:8, color:DIM, marginTop:3, letterSpacing:.3 }}>{c.note}</div>}
                    </div>
                  );
                }) : (
                  <div style={{ fontSize:9, color:"#32d74b", letterSpacing:1 }}>
                    ✓ No criminal cases on record
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding:"12px 20px", borderTop:`1px solid rgba(255,179,64,0.05)`,
              display:"flex", justifyContent:"space-between", background:"rgba(0,0,0,0.2)",
              flexShrink:0 }}>
              <div style={{ fontSize:7, color:DIM+"66", letterSpacing:2 }}>
                SOURCE: ECI · MYNETA · MCA21 · NJDG · SANSAD.IN
              </div>
              <div style={{ display:"flex", gap:10 }}>
                {[["NJDG","https://njdg.ecourts.gov.in"],["SANSAD","https://sansad.in"],["MYNETA","https://myneta.info"]].map(([l,u])=>(
                  <a key={l} href={u} target="_blank" rel="noreferrer"
                    style={{ fontSize:7, color:DIM, letterSpacing:2,
                      borderBottom:`1px solid ${DIM}44`, paddingBottom:1 }}>{l}</a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
