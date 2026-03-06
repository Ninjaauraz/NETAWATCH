// lib/scoring.js — NetaWatch Scoring Engine v3
// Incorporates: ECI affidavits, MCA21 directorships, electoral bonds,
// benami attachments, ITAT orders, Panama/Pandora Papers

export const WEIGHTS = {
  wealthGap:        0.22,  // Absolute wealth vs public salary baseline
  directorships:    0.18,  // MCA21 — undisclosed/post-appointment companies
  electoralBonds:   0.15,  // Bond donors under investigation
  criminalCases:    0.15,  // Pending cases, count + severity
  tradeTiming:      0.12,  // Trades near policy events
  networkRisk:      0.10,  // Family/associate activity
  disclosure:       0.08,  // Late filings, amendments after media
};

// ── Wealth Gap Score ──────────────────────────────────────────────────────────
// A public servant's entire 30-year salary ≈ ₹4.5Cr max
// Anything beyond needs explanation — business, inheritance, etc.
function scoreWealthGap({ totalAssets, declaredIncome, directorships }) {
  const years   = Object.keys(totalAssets || {}).sort();
  const latest  = totalAssets?.[years[years.length - 1]] || 0;
  const declared = Object.values(declaredIncome || {}).reduce((a, b) => a + b, 0);

  // Multi-year: score growth vs declared income
  if (years.length >= 2) {
    const earliest = totalAssets[years[0]] || 0;
    const growth   = latest - earliest;
    if (declared > 0) {
      const ratio = growth / declared;
      if (ratio <= 1)   return Math.min(Math.round(ratio * 15), 15);
      if (ratio <= 3)   return Math.round(15 + ((ratio - 1) / 2) * 20);
      if (ratio <= 8)   return Math.round(35 + ((ratio - 3) / 5) * 25);
      if (ratio <= 20)  return Math.round(60 + ((ratio - 8) / 12) * 20);
      return Math.min(80 + Math.round((ratio - 20) / 10), 95);
    }
  }

  // Single-year: score absolute wealth
  // ₹4.5Cr = plausible public servant max → anything above is suspicious
  if (latest <= 1)   return 5;
  if (latest <= 4.5) return Math.round(5 + (latest / 4.5) * 10);
  if (latest <= 15)  return Math.round(15 + ((latest - 4.5) / 10.5) * 20);
  if (latest <= 50)  return Math.round(35 + ((latest - 15) / 35) * 25);
  if (latest <= 150) return Math.round(60 + ((latest - 50) / 100) * 20);
  if (latest <= 500) return Math.round(80 + ((latest - 150) / 350) * 12);
  return 95;
}

// ── Directorship Score (MCA21) ────────────────────────────────────────────────
function scoreDirectorships({ directorships, holdings }) {
  if (!directorships?.length) return 0;

  const active = directorships.filter(d => !d.dateOfCessation?.trim());
  const total  = directorships.length;

  // Post-appointment companies are the main red flag
  const postAppt = directorships.filter(d => d.formedAfterAppt).length;

  // Undisclosed = in MCA21 but not in affidavit holdings
  const declaredCompanyCount = holdings?.length || 0;
  const undisclosed = Math.max(0, total - declaredCompanyCount);

  let score = 0;
  score += Math.min(active * 5, 30);          // each active directorship
  score += Math.min(postAppt * 15, 45);        // post-appointment = major flag
  score += Math.min(undisclosed * 10, 30);     // undisclosed in affidavit

  return Math.min(score, 100);
}

// ── Electoral Bonds Score ──────────────────────────────────────────────────────
function scoreElectoralBonds({ electoralBonds }) {
  if (!electoralBonds) return 0;

  const { suspiciousDonors = [], partyReceivedCr = 0 } = electoralBonds;

  let score = 0;

  // Party received bonds from companies under ED/CBI investigation
  score += Math.min(suspiciousDonors.length * 20, 60);

  // Total bond value received by party (scale)
  if (partyReceivedCr > 1000) score += 30;
  else if (partyReceivedCr > 500) score += 20;
  else if (partyReceivedCr > 100) score += 10;

  return Math.min(score, 100);
}

// ── Criminal Cases Score ──────────────────────────────────────────────────────
function scoreCriminalCases({ criminalCases, partyHistory }) {
  if (!criminalCases?.length) return 0;

  const pending  = criminalCases.filter(c => c.status === "PENDING");
  const serious  = pending.filter(c =>
    /IPC|302|307|376|420|ED|CBI|money launder|disproportionate|benami|murder|rape|kidnap|dacoity|terror/i
      .test((c.case || "") + (c.note || ""))
  );
  const dropped  = criminalCases.filter(c => c.status === "DROPPED" && c.resolvedYear);

  let score = 0;
  score += Math.min(pending.length * 10, 50);   // each pending case
  score += Math.min(serious.length * 15, 40);   // serious IPC cases extra weight

  // Cases dropped near party switch
  if (dropped.length > 0 && partyHistory?.length > 1) {
    const switchYears = partyHistory.slice(1).map(p => p.from);
    dropped.forEach(c => {
      const proximity = switchYears.some(yr => Math.abs(c.resolvedYear - yr) <= 2);
      if (proximity) score += 20;
    });
  }

  return Math.min(score, 100);
}

// ── Trade Timing Score ────────────────────────────────────────────────────────
function scoreTradeTiming({ tradeEvents }) {
  if (!tradeEvents?.length) return 0;
  const scores = tradeEvents.map(e => {
    const days = (new Date(e.policyDate) - new Date(e.date)) / 86400000;
    if (days <= 0) return 0;
    let s;
    if (days <= 30)  s = 90;
    else if (days <= 90)  s = 65;
    else if (days <= 180) s = 35;
    else if (days <= 365) s = 15;
    else s = 5;
    return s * Math.min(1 + Math.log10(Math.max(e.valueCr, 0.1)) * 0.1, 1.3);
  }).sort((a, b) => b - a);
  return Math.min(Math.round(scores[0] + scores.slice(1).reduce((s, v) => s + v * 0.2, 0)), 100);
}

// ── Network Risk Score ────────────────────────────────────────────────────────
function scoreNetworkRisk({ network }) {
  if (!network?.length) return 0;
  const PROX = { spouse:1.0, child:0.9, sibling:0.7, parent:0.6, associate:0.8, shell_company:1.0 };
  let total = 0;
  network.forEach(n => {
    const prox = PROX[n.type] || 0.5;
    let s = 0;
    if (n.holdingsInConflictSectors) s += 25;
    if (n.tradeBeforePolicy)         s += 35;
    if (n.govtContractWon)           s += 30;
    if (n.govtContractWon && n.contractValueCr)
      s += Math.min(Math.log10(n.contractValueCr) * 5, 15);
    total += s * prox;
  });
  return Math.min(Math.round((total / (network.length * 100)) * 150), 100);
}

// ── Disclosure Score ──────────────────────────────────────────────────────────
function scoreDisclosure({ disclosure }) {
  if (!disclosure) return 0;
  const { lateFilings=0, amendmentsAfterMedia=0, assetsFoundInAudit=0, missingYears=0 } = disclosure;
  return Math.min(lateFilings*8 + amendmentsAfterMedia*15 + assetsFoundInAudit*25 + missingYears*20, 100);
}

// ── Main scoring function ──────────────────────────────────────────────────────
export function scorePolitician(p) {
  const subScores = {
    wealthGap:      scoreWealthGap(p),
    directorships:  scoreDirectorships(p),
    electoralBonds: scoreElectoralBonds(p),
    criminalCases:  scoreCriminalCases(p),
    tradeTiming:    scoreTradeTiming(p),
    networkRisk:    scoreNetworkRisk(p),
    disclosure:     scoreDisclosure(p),
  };

  const final = Math.min(100, Math.round(
    Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (subScores[k] || 0) * w, 0)
  ));

  const riskLevel = final >= 75 ? "CRITICAL" : final >= 55 ? "HIGH" : final >= 35 ? "MODERATE" : "LOW";

  // ── Generate human-readable flags ──────────────────────────────────────────
  const flags = [];
  const latest = Object.values(p.totalAssets || {}).pop() || 0;

  // Wealth
  if (latest > 100)
    flags.push({ icon:"💰", type:"WEALTH",    text:`Net worth ₹${latest}Cr — ${Math.round(latest/14.7)}× avg MP. No business background declared.` });
  else if (latest > 20)
    flags.push({ icon:"💰", type:"WEALTH",    text:`Declared ₹${latest}Cr on a public salary. Unexplained wealth gap of ₹${Math.max(0,latest-4.5).toFixed(1)}Cr.` });

  // Directorships
  if ((p.directorships?.length || 0) > 0) {
    const post = p.directorships.filter(d => d.formedAfterAppt).length;
    flags.push({ icon:"🏢", type:"MCA21",     text:`${p.directorships.length} company directorships found in MCA21.${post > 0 ? ` ${post} formed after appointment.` : ""}` });
  }

  // Electoral bonds
  if ((p.electoralBonds?.suspiciousDonors?.length || 0) > 0)
    flags.push({ icon:"🏦", type:"BONDS",     text:`Party received electoral bonds from ${p.electoralBonds.suspiciousDonors.map(d=>d.name).join(", ")} — companies under regulatory scrutiny.` });

  // Cases
  if ((p.criminalCases?.length || 0) >= 5)
    flags.push({ icon:"⚖️",  type:"CASES",    text:`${p.criminalCases.length} pending criminal cases declared in affidavit.` });
  else if ((p.criminalCases?.length || 0) > 0)
    flags.push({ icon:"⚖️",  type:"CASES",    text:`${p.criminalCases.length} criminal case${p.criminalCases.length>1?"s":""} pending — no resolution in years.` });

  // Corruption flags from enrichment
  if (p.corruptionFlags?.length > 0) {
    p.corruptionFlags.forEach(f => {
      if (!flags.some(existing => existing.text === f.detail)) {
        flags.push({ icon: f.type==="ELECTORAL_BOND"?"🏦":f.type==="DIRECTORSHIP"?"🏢":"🚩",
          type: f.type, text: f.detail, source: f.source });
      }
    });
  }

  return { final, subScores, riskLevel, flags };
}

export function scoreBatch(politicians) {
  return politicians
    .map(p => ({ ...p, scoring: scorePolitician(p) }))
    .sort((a, b) => b.scoring.final - a.scoring.final);
}

// Export dimension labels for UI
export const DIMS = [
  { key:"wealthGap",      label:"Wealth Gap",    desc:"Assets vs public salary baseline"         },
  { key:"directorships",  label:"Companies",     desc:"MCA21 directorships — disclosed vs actual" },
  { key:"electoralBonds", label:"Bonds",         desc:"Electoral bond donor connections"          },
  { key:"criminalCases",  label:"Cases",         desc:"Pending cases — count & severity"          },
  { key:"tradeTiming",    label:"Trade Timing",  desc:"Trades near policy events"                 },
  { key:"networkRisk",    label:"Network",       desc:"Family & associate activity"               },
  { key:"disclosure",     label:"Disclosure",    desc:"Late or amended declarations"              },
];
