"use client";
import { useState, useEffect, useRef, useMemo } from "react";

// ─── SCORING ──────────────────────────────────────────────────────────────────
export function computeScore(p) {
  const yrs    = Object.keys(p.totalAssets || {}).sort();
  const latest = p.totalAssets?.[yrs[yrs.length - 1]] || 0;
  const first  = p.totalAssets?.[yrs[0]] || 0;
  const income = Object.values(p.declaredIncome || {}).reduce((a, b) => a + b, 0);
  const cases  = p.criminalCases || [];
  const pending= cases.filter(c => c.status === "PENDING");
  const dropped= cases.filter(c => c.status === "DROPPED");

  // Wealth vs income
  let wealth = 0;
  if (yrs.length >= 2 && income > 0) {
    const r = (latest - first) / income;
    wealth = r <= 1 ? r * 18 : r <= 5 ? 18 + (r-1)/4*30 : r <= 15 ? 48 + (r-5)/10*27 : Math.min(75 + (r-15)/15*15, 96);
  } else {
    wealth = latest <= 4.5 ? (latest/4.5)*17 : latest <= 50 ? 17 + (latest-4.5)/45.5*43 : Math.min(60 + (latest-50)/200*36, 97);
  }

  // Cases — especially suspicious drops near party switches
  let caseScore = Math.min(pending.length * 12 + pending.filter(c => /ED|CBI|murder|launder|benami/i.test(c.case || "")).length * 14, 100);
  if (dropped.length && (p.partyHistory?.length || 0) > 1) {
    const switchYrs = p.partyHistory.slice(1).map(x => x.from);
    dropped.forEach(d => {
      if (d.resolvedYear && switchYrs.some(y => Math.abs(d.resolvedYear - y) <= 2)) caseScore = Math.min(caseScore + 20, 100);
    });
  }

  // Network
  const NW = { spouse: 1, child: 0.9, sibling: 0.7, associate: 0.8, shell_company: 1 };
  let netRisk = 0;
  (p.network || []).forEach(n => {
    const w = NW[n.type] || 0.5;
    netRisk += ((n.tradeBeforePolicy ? 38 : 0) + (n.govtContractWon ? 32 + Math.min(Math.log10(Math.max(n.contractValueCr || 1, 1)) * 6, 18) : 0) + (n.holdingsInConflictSectors ? 20 : 0)) * w;
  });
  const networkScore = Math.min((netRisk / Math.max((p.network || []).length, 1) / 100) * 150, 100);

  // Trade timing
  const tradeScore = !(p.tradeEvents?.length) ? 0 : Math.min(
    (p.tradeEvents || []).map(e => { const d = (new Date(e.policyDate) - new Date(e.date)) / 86400000; return d <= 0 ? 0 : d <= 30 ? 92 : d <= 90 ? 68 : d <= 180 ? 38 : 14; })
      .sort((a, b) => b - a).reduce((s, v, i) => s + (i === 0 ? v : v * 0.25), 0), 100);

  const disc = p.disclosure || {};
  const discScore = Math.min((disc.lateFilings||0)*8 + (disc.amendmentsAfterMedia||0)*18 + (disc.assetsFoundInAudit||0)*28 + (disc.missingYears||0)*22, 100);

  const final = Math.round(wealth * 0.28 + caseScore * 0.22 + networkScore * 0.18 + tradeScore * 0.16 + discScore * 0.10 + Math.min((p.holdings || []).filter(h => h.conflict).length * 16, 100) * 0.06);
  const tier  = final >= 80 ? "critical" : final >= 60 ? "high" : final >= 38 ? "elevated" : final >= 18 ? "low" : "clear";

  return { final, tier, wealth: Math.round(wealth), cases: caseScore, network: Math.round(networkScore), trades: Math.round(tradeScore), disclosure: discScore, netWorth: latest, pendingCases: pending.length, unexplained: Math.max(0, latest - 4.5) };
}

export function scoreBatch(arr) {
  return arr.map(p => ({ ...p, _s: computeScore(p) })).sort((a, b) => b._s.final - a._s.final);
}

// ─── DESIGN ───────────────────────────────────────────────────────────────────
const TIER = {
  critical: { dot: "#dc2626", bg: "#fef2f2", text: "#991b1b", label: "Critical"  },
  high:     { dot: "#ea580c", bg: "#fff7ed", text: "#9a3412", label: "High Risk" },
  elevated: { dot: "#ca8a04", bg: "#fefce8", text: "#854d0e", label: "Elevated"  },
  low:      { dot: "#16a34a", bg: "#f0fdf4", text: "#15803d", label: "Low Risk"  },
  clear:    { dot: "#2563eb", bg: "#eff6ff", text: "#1d4ed8", label: "Clear"     },
};

const PARTY_COLORS = {
  BJP: "#f97316", INC: "#3b82f6", TMC: "#10b981", AAP: "#06b6d4",
  NCP: "#8b5cf6", SP: "#f43f5e", BSP: "#6366f1", DMK: "#ef4444", IND: "#9ca3af",
};
const partyColor = p => PARTY_COLORS[p?.toUpperCase()] || "#9ca3af";
const proxy = u => !u ? "" : (u.includes("wikimedia") || u.includes("wikipedia")) ? `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=120&h=120&fit=cover` : u;

// ─── ASSET CHART (pure SVG, no library) ───────────────────────────────────────
function AssetSparkline({ totalAssets }) {
  const yrs = Object.keys(totalAssets || {}).sort();
  if (yrs.length < 2) return null;
  const vals = yrs.map(y => totalAssets[y]);
  const max  = Math.max(...vals);
  const W = 120, H = 32, pad = 4;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x},${y}`;
  });
  const area = `M ${pts[0]} L ${pts.join(" L ")} L ${pad + (W - pad*2)},${H} L ${pad},${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dc2626" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#dc2626" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)"/>
      <polyline points={pts.join(" ")} fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
        const y = H - pad - (v / max) * (H - pad * 2);
        return <circle key={i} cx={x} cy={y} r="2" fill="#dc2626"/>;
      })}
    </svg>
  );
}

// ─── WEALTH BAR COMPARISON ─────────────────────────────────────────────────────
function WealthComparison({ netWorth }) {
  const maxBar = Math.max(netWorth, 15);
  const items = [
    { label: "This MP", value: netWorth, color: "#dc2626" },
    { label: "Avg MP", value: 14.7, color: "#e5e7eb" },
    { label: "Govt salary (30yr)", value: 4.5, color: "#e5e7eb" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(({ label, value, color }) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>₹{value}Cr</span>
          </div>
          <div style={{ height: 4, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(value / maxBar) * 100}%`, background: color, borderRadius: 2, transition: "width 0.6s ease" }}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── TIMELINE ─────────────────────────────────────────────────────────────────
function Timeline({ events }) {
  if (!events?.length) return <p style={{ fontSize: 13, color: "#9ca3af", padding: "4px 0" }}>No timeline data</p>;
  const typeColor = { party: "#8b5cf6", legal: "#dc2626", appt: "#2563eb", trade: "#ea580c", policy: "#9ca3af", gain: "#16a34a", contract: "#dc2626" };
  return (
    <div style={{ position: "relative", paddingLeft: 20 }}>
      <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 1, background: "#e5e7eb" }}/>
      {events.map((ev, i) => {
        const c = typeColor[ev.type] || "#9ca3af";
        return (
          <div key={i} style={{ position: "relative", marginBottom: 16 }}>
            <div style={{ position: "absolute", left: -14, top: 4, width: 8, height: 8, borderRadius: "50%", background: ev.flag ? c : "#fff", border: `2px solid ${c}` }}/>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{ev.date}</div>
            <div style={{ fontSize: 13, color: ev.flag ? "#111" : "#6b7280", fontWeight: ev.flag ? 500 : 400, lineHeight: 1.4 }}>{ev.event}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── POLITICIAN CARD (list item) ──────────────────────────────────────────────
function PolCard({ p, onClick, hasNews }) {
  const sc  = p._s;
  const t   = TIER[sc.tier];
  const pc  = partyColor(p.party);
  const [imgErr, setImgErr] = useState(false);
  const photo = proxy(p.photo);

  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left",
      background: "#fff", border: "none", borderBottom: "1px solid #f3f4f6",
      padding: "14px 16px", cursor: "pointer",
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* Photo */}
        <div style={{ width: 44, height: 44, borderRadius: 8, flexShrink: 0, overflow: "hidden", background: "#f9fafb" }}>
          {photo && !imgErr
            ? <img src={photo} alt={p.name} onError={() => setImgErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: pc, background: `${pc}15` }}>
                {p.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
              </div>}
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#111", fontFamily: "Georgia, serif", letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            {hasNews && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }}/>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: pc }}>{p.party}</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>·</span>
            <span style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{p.constituency || p.state}</span>
            {sc.pendingCases > 0 && <>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>·</span>
              <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 500 }}>{sc.pendingCases} case{sc.pendingCases > 1 ? "s" : ""}</span>
            </>}
          </div>
        </div>

        {/* Score */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: t.bg, padding: "4px 10px", borderRadius: 20 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.dot, flexShrink: 0 }}/>
            <span style={{ fontSize: 14, fontWeight: 700, color: t.text, fontVariantNumeric: "tabular-nums" }}>{sc.final}</span>
          </div>
          <span style={{ fontSize: 10, color: "#9ca3af" }}>₹{sc.netWorth}Cr</span>
        </div>
      </div>
    </button>
  );
}

// ─── DETAIL SHEET ─────────────────────────────────────────────────────────────
function DetailSheet({ p, news, onClose }) {
  const sc   = p._s;
  const t    = TIER[sc.tier];
  const pc   = partyColor(p.party);
  const sheetRef = useRef(null);
  const [imgErr, setImgErr] = useState(false);
  const photo = proxy(p.photo);
  const [tab, setTab] = useState("overview");

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const yrs = Object.keys(p.totalAssets || {}).sort();

  const subScores = [
    { label: "Wealth gap",      value: sc.wealth   },
    { label: "Criminal cases",  value: sc.cases    },
    { label: "Network risk",    value: sc.network  },
    { label: "Trade timing",    value: sc.trades   },
    { label: "Disclosure",      value: sc.disclosure },
  ];

  const TABS = ["overview", "cases", "network", "timeline", "news"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", flexDirection: "column" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }}/>

      {/* Sheet */}
      <div ref={sheetRef} style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: "92dvh", background: "#fafaf8",
        borderRadius: "16px 16px 0 0", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
        animation: "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
      }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#d1d5db" }}/>
        </div>

        {/* Header */}
        <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
            {/* Photo */}
            <div style={{ width: 56, height: 56, borderRadius: 10, flexShrink: 0, overflow: "hidden", background: "#f3f4f6" }}>
              {photo && !imgErr
                ? <img src={photo} alt={p.name} onError={() => setImgErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: pc, background: `${pc}15` }}>
                    {p.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
                  </div>}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111", fontFamily: "Georgia, serif", letterSpacing: -0.3, lineHeight: 1.2, margin: "0 0 4px" }}>{p.name}</h2>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{p.role}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: pc, background: `${pc}15`, padding: "2px 8px", borderRadius: 4 }}>{p.party}</span>
                {p.chamber === "RS" && <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>Rajya Sabha</span>}
                <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>{p.state}</span>
              </div>
            </div>

            {/* Close */}
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "#f3f4f6", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#6b7280", fontSize: 16 }}>×</button>
          </div>

          {/* Risk score banner */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: t.bg, borderRadius: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: t.dot, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{sc.final}</span>
              <span style={{ fontSize: 10, color: t.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.label}</span>
            </div>
            <div style={{ width: 1, height: 36, background: `${t.dot}33` }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: t.text, fontWeight: 500, marginBottom: 3 }}>
                Declared ₹{sc.netWorth}Cr net worth
                {sc.unexplained > 5 && ` · ₹${sc.unexplained.toFixed(1)}Cr unexplained`}
              </div>
              {sc.pendingCases > 0
                ? <div style={{ fontSize: 12, color: "#dc2626" }}>{sc.pendingCases} pending criminal case{sc.pendingCases > 1 ? "s" : ""}</div>
                : <div style={{ fontSize: 12, color: "#16a34a" }}>No pending criminal cases</div>}
            </div>
          </div>

          {/* Sub-score bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 14 }}>
            {subScores.map(({ label, value }) => {
              const c = value > 65 ? "#dc2626" : value > 38 ? "#ea580c" : value > 20 ? "#ca8a04" : "#16a34a";
              return (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: c }}>{value}</span>
                  </div>
                  <div style={{ height: 3, background: "#e5e7eb", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${value}%`, background: c, borderRadius: 2 }}/>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e5e7eb", marginBottom: 0, overflowX: "auto" }}>
            {TABS.map(tabKey => (
              <button key={tabKey} onClick={() => setTab(tabKey)} style={{
                background: "none", border: "none", padding: "8px 14px",
                fontSize: 13, fontWeight: tab === tabKey ? 600 : 400,
                color: tab === tabKey ? "#111" : "#9ca3af",
                borderBottom: tab === tabKey ? "2px solid #111" : "2px solid transparent",
                cursor: "pointer", whiteSpace: "nowrap", textTransform: "capitalize",
                fontFamily: "inherit",
              }}>{tabKey === "news" && news?.length > 0 ? `${tabKey} (${news.length})` : tabKey}</button>
            ))}
          </div>
        </div>

        {/* Scrollable tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 32px" }}>

          {/* ── OVERVIEW ── */}
          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Wealth section */}
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>Wealth</h3>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
                  <AssetSparkline totalAssets={p.totalAssets}/>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#111", lineHeight: 1 }}>₹{sc.netWorth}Cr</div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>net worth, {yrs[yrs.length - 1]}</div>
                    {yrs.length >= 2 && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                      ₹{sc.unexplained.toFixed(1)}Cr unexplained
                    </div>}
                  </div>
                </div>
                <WealthComparison netWorth={sc.netWorth}/>
              </div>

              {/* Party history */}
              {(p.partyHistory?.length || 0) > 0 && (
                <div>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Party History</h3>
                  <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
                    {p.partyHistory.map((ph, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                        <div style={{ padding: "6px 10px", background: `${partyColor(ph.party)}12`, borderRadius: 6, border: `1px solid ${partyColor(ph.party)}30` }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: partyColor(ph.party) }}>{ph.party}</div>
                          <div style={{ fontSize: 10, color: "#9ca3af" }}>{ph.from}–{ph.to === 2024 ? "now" : ph.to}</div>
                        </div>
                        {i < p.partyHistory.length - 1 && <div style={{ fontSize: 11, color: "#d1d5db", padding: "0 4px" }}>→</div>}
                      </div>
                    ))}
                  </div>
                  {(p.partyHistory?.length || 0) > 2 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#ea580c", background: "#fff7ed", padding: "6px 10px", borderRadius: 6 }}>
                      {(p.partyHistory.length - 1)} party switches detected — cross-reference with case dismissals
                    </div>
                  )}
                </div>
              )}

              {/* Holdings */}
              {p.holdings?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Holdings</h3>
                  {p.holdings.map((h, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#111" }}>{h.sector}</span>
                        {h.conflict && <span style={{ fontSize: 10, color: "#dc2626", background: "#fef2f2", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>Conflict</span>}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>₹{h.value}Cr</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Source links */}
              <div style={{ paddingTop: 8, borderTop: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Verify independently</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["NJDG", "https://njdg.ecourts.gov.in"], ["Sansad.in", "https://sansad.in"], ["MyNeta", "https://myneta.info"], ["MCA21", "https://mca.gov.in"]].map(([label, url]) => (
                    <a key={label} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb", background: "#eff6ff", padding: "5px 10px", borderRadius: 6, textDecoration: "none" }}>{label} ↗</a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── CASES ── */}
          {tab === "cases" && (
            <div>
              {!p.criminalCases?.length
                ? <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                    <div style={{ fontSize: 15, color: "#16a34a", fontWeight: 600 }}>No criminal cases declared</div>
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Sourced from ECI affidavit</div>
                  </div>
                : p.criminalCases.map((c, i) => {
                    const statusColor = c.status === "PENDING" ? "#dc2626" : c.status === "DROPPED" ? "#ea580c" : "#16a34a";
                    const statusBg    = c.status === "PENDING" ? "#fef2f2" : c.status === "DROPPED" ? "#fff7ed" : "#f0fdf4";
                    return (
                      <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, background: statusBg, padding: "2px 8px", borderRadius: 4, flexShrink: 0 }}>
                            {c.status === "PENDING" ? "● Pending" : c.status === "DROPPED" ? "Dropped" : "Acquitted"}
                          </span>
                          {c.resolvedYear && <span style={{ fontSize: 11, color: "#9ca3af" }}>{c.resolvedYear}</span>}
                        </div>
                        <div style={{ fontSize: 14, color: "#111", marginBottom: c.note ? 4 : 0, lineHeight: 1.4 }}>{c.case}</div>
                        {c.note && <div style={{ fontSize: 12, color: "#ea580c", background: "#fff7ed", padding: "5px 9px", borderRadius: 6 }}>{c.note}</div>}
                      </div>
                    );
                  })}
            </div>
          )}

          {/* ── NETWORK ── */}
          {tab === "network" && (
            <div>
              {!p.network?.length
                ? <p style={{ fontSize: 13, color: "#9ca3af", paddingTop: 8 }}>No network data on file</p>
                : p.network.map((n, i) => {
                    const risk = (n.tradeBeforePolicy ? 38 : 0) + (n.govtContractWon ? 35 : 0) + (n.holdingsInConflictSectors ? 22 : 0);
                    const c    = risk > 55 ? "#dc2626" : risk > 30 ? "#ea580c" : "#6b7280";
                    return (
                      <div key={i} style={{ padding: "13px 0", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 2 }}>{n.name}</div>
                            <span style={{ fontSize: 11, color: "#9ca3af", background: "#f9fafb", padding: "1px 7px", borderRadius: 4 }}>{n.type.replace(/_/g, " ")}</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{risk}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {n.holdingsInConflictSectors && <span style={{ fontSize: 11, color: "#ea580c", background: "#fff7ed", padding: "2px 8px", borderRadius: 4 }}>Conflict holdings</span>}
                          {n.tradeBeforePolicy        && <span style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 4 }}>Traded before policy</span>}
                          {n.govtContractWon          && <span style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 4 }}>₹{n.contractValueCr}Cr govt contract</span>}
                        </div>
                      </div>
                    );
                  })}
            </div>
          )}

          {/* ── TIMELINE ── */}
          {tab === "timeline" && <Timeline events={p.timeline}/>}

          {/* ── NEWS ── */}
          {tab === "news" && (
            <div>
              {!news?.length
                ? <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "#9ca3af" }}>Fetching live news…</div>
                  </div>
                : news.map((n, i) => (
                    <a key={i} href={n.link} target="_blank" rel="noreferrer"
                      style={{ display: "block", padding: "13px 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none" }}>
                      {n.isCourt && <span style={{ fontSize: 10, fontWeight: 600, color: "#dc2626", background: "#fef2f2", padding: "1px 6px", borderRadius: 4, display: "inline-block", marginBottom: 5 }}>Court</span>}
                      <div style={{ fontSize: 14, color: "#111", lineHeight: 1.45, marginBottom: 4 }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{n.src} · {n.date}</div>
                    </a>
                  ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function NetaWatchClient({ initialData }) {
  const [pols,     setPols]    = useState(initialData);
  const [selected, setSelected]= useState(null);
  const [query,    setQuery]   = useState("");
  const [sortBy,   setSortBy]  = useState("score");
  const [newsMap,  setNewsMap] = useState({});
  const [newsPols, setNewsPols]= useState(new Set()); // ids with new news
  const [connected,setConn]    = useState(false);
  const [liveCount,setLC]      = useState(0);
  const [showSort, setShowSort]= useState(false);

  // SSE
  useEffect(() => {
    let src;
    const connect = () => {
      src = new EventSource("/api/stream");
      src.addEventListener("init", e => {
        setPols(JSON.parse(e.data).politicians);
        setConn(true);
      });
      src.addEventListener("news", e => {
        const { id, news } = JSON.parse(e.data);
        setNewsMap(m => ({ ...m, [id]: news }));
        setNewsPols(s => new Set([...s, id]));
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
    if (sortBy === "score")  arr.sort((a, b) => b._s.final - a._s.final);
    if (sortBy === "wealth") arr.sort((a, b) => (b._s?.netWorth || 0) - (a._s?.netWorth || 0));
    if (sortBy === "cases")  arr.sort((a, b) => (b._s?.pendingCases || 0) - (a._s?.pendingCases || 0));
    if (sortBy === "name")   arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [pols, sortBy]);

  const filtered = useMemo(() => {
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter(p => `${p.name} ${p.party} ${p.state} ${p.constituency}`.toLowerCase().includes(q));
  }, [sorted, query]);

  const selPol  = selected ? pols.find(p => p.id === selected) : null;
  const selNews = selPol ? (newsMap[selPol.id] || []) : [];

  const SORT_LABELS = { score: "Risk score", wealth: "Wealth", cases: "Cases", name: "Name" };

  return (
    <div style={{ background: "#fafaf8", minHeight: "100dvh", maxWidth: 540, margin: "0 auto" }}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: #e5e7eb; }
        button { font-family: inherit; } a { font-family: inherit; }
        input::placeholder { color: #9ca3af; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "#fafaf8", borderBottom: "1px solid #e5e7eb", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#111", fontFamily: "Georgia, serif", letterSpacing: -0.3 }}>NetaWatch</span>
            <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 8 }}>India</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {connected && liveCount > 0 && <span style={{ fontSize: 11, color: "#2563eb" }}>{liveCount} live</span>}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#16a34a" : "#9ca3af" }}/>
              <span style={{ fontSize: 11, color: connected ? "#16a34a" : "#9ca3af" }}>{connected ? "Live" : "Offline"}</span>
            </div>
          </div>
        </div>

        {/* Search + sort */}
        <div style={{ display: "flex", gap: 8, paddingBottom: 10 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 15, pointerEvents: "none" }}>⌕</span>
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search politicians, parties…"
              style={{ width: "100%", background: "#f3f4f6", border: "1px solid transparent", borderRadius: 10, padding: "8px 10px 8px 30px", fontSize: 14, color: "#111", outline: "none" }}
            />
          </div>
          <button onClick={() => setShowSort(s => !s)}
            style={{ background: "#f3f4f6", border: "1px solid transparent", borderRadius: 10, padding: "0 12px", fontSize: 13, color: "#6b7280", cursor: "pointer", whiteSpace: "nowrap", height: 38 }}>
            {SORT_LABELS[sortBy]} ↕
          </button>
        </div>

        {/* Sort dropdown */}
        {showSort && (
          <div style={{ position: "absolute", right: 16, top: 90, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 4, boxShadow: "0 4px 24px rgba(0,0,0,0.1)", zIndex: 60, minWidth: 150 }}>
            {Object.entries(SORT_LABELS).map(([k, l]) => (
              <button key={k} onClick={() => { setSortBy(k); setShowSort(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: sortBy === k ? "#f3f4f6" : "none", border: "none", borderRadius: 7, fontSize: 14, color: sortBy === k ? "#111" : "#6b7280", cursor: "pointer", fontWeight: sortBy === k ? 600 : 400 }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── STATS STRIP ── */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
        {[
          [pols.length, "politicians"],
          [pols.filter(p => p._s?.tier === "critical").length, "critical"],
          [pols.reduce((s, p) => s + (p._s?.pendingCases || 0), 0), "cases"],
        ].map(([v, l]) => (
          <div key={l} style={{ flex: 1, padding: "10px 0", textAlign: "center", borderRight: "1px solid #f3f4f6" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: l === "critical" ? "#dc2626" : "#111", lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.3 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── LIST ── */}
      <div style={{ background: "#fff" }}>
        {filtered.map(p => (
          <PolCard key={p.id} p={p} hasNews={newsPols.has(p.id)}
            onClick={() => { setSelected(p.id); setNewsPols(s => { const n = new Set(s); n.delete(p.id); return n; }); }}/>
        ))}
        {!filtered.length && (
          <div style={{ padding: "40px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#9ca3af" }}>No results for "{query}"</div>
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      <div style={{ padding: "20px 16px", borderTop: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.6 }}>
          Source: ECI affidavits · MCA21 · NJDG · Sansad.in<br/>
          All data is public record
        </div>
      </div>

      {/* ── DETAIL SHEET ── */}
      {selPol && (
        <DetailSheet p={selPol} news={selNews} onClose={() => setSelected(null)}/>
      )}

      {/* Close sort when clicking away */}
      {showSort && <div onClick={() => setShowSort(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }}/>}
    </div>
  );
}
