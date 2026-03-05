// lib/scoring.js — NetaWatch Scoring Engine v2
// Handles both full multi-year data AND single-year ECI scrape data

export const WEIGHTS = {
  incomeGap:      0.25,
  sectorConflict: 0.20,
  tradeTiming:    0.20,
  caseDisposal:   0.15,
  networkRisk:    0.12,
  disclosure:     0.08,
};

const T = {
  incomeGap:    { low:2, moderate:5, high:10, extreme:20 },
  tradeTiming:  { critical:30, high:90, moderate:180, low:365 },
  caseDisposal: { critical:6, high:12, moderate:24 },
  // Absolute wealth thresholds (crore) for single-year scoring
  wealth:       { low:1, moderate:5, high:25, veryHigh:100, extreme:500 },
};

function scoreIncomeGap({ totalAssets, declaredIncome }) {
  const years   = Object.keys(totalAssets || {}).map(Number).sort();
  const values  = years.map(y => totalAssets[y]);
  const latest  = values[values.length - 1] || 0;
  const declared = Object.values(declaredIncome || {}).reduce((a, b) => a + b, 0);

  // ── Multi-year mode: compare growth vs declared income ──────────────────
  if (years.length >= 2) {
    const growth = latest - values[0];
    if (declared <= 0) {
      // No declared income — score on absolute wealth alone
      return scoreWealthAbsolute(latest);
    }
    const ratio = growth / declared;
    if (ratio <= T.incomeGap.low)      return Math.round((ratio / T.incomeGap.low) * 20);
    if (ratio <= T.incomeGap.moderate) return Math.round(20 + ((ratio - T.incomeGap.low) / (T.incomeGap.moderate - T.incomeGap.low)) * 25);
    if (ratio <= T.incomeGap.high)     return Math.round(45 + ((ratio - T.incomeGap.moderate) / (T.incomeGap.high - T.incomeGap.moderate)) * 25);
    if (ratio <= T.incomeGap.extreme)  return Math.round(70 + ((ratio - T.incomeGap.high) / (T.incomeGap.extreme - T.incomeGap.high)) * 20);
    return 95;
  }

  // ── Single-year mode: score on absolute declared wealth ─────────────────
  // A newly elected MP declaring ₹200Cr with no income explanation is suspicious
  return scoreWealthAbsolute(latest);
}

function scoreWealthAbsolute(crore) {
  // Baseline: a public servant earning ~₹15L/yr over 30yr career = ~₹4.5Cr max
  // Anything beyond that with no clear business source is flaggable
  const t = T.wealth;
  if (crore <= t.low)      return 5;
  if (crore <= t.moderate) return Math.round(5  + ((crore - t.low)      / (t.moderate - t.low))      * 20);
  if (crore <= t.high)     return Math.round(25 + ((crore - t.moderate) / (t.high - t.moderate))     * 25);
  if (crore <= t.veryHigh) return Math.round(50 + ((crore - t.high)     / (t.veryHigh - t.high))     * 25);
  if (crore <= t.extreme)  return Math.round(75 + ((crore - t.veryHigh) / (t.extreme - t.veryHigh))  * 15);
  return 95;
}

function scoreSectorConflict({ holdings }) {
  if (!holdings?.length) return 0;
  const total      = holdings.reduce((s, h) => s + h.value, 0);
  const conflicted = holdings.filter(h => h.conflict).reduce((s, h) => s + h.value, 0);
  const pct        = total > 0 ? (conflicted / total) * 100 : 0;
  const bonus      = Math.min(holdings.filter(h => h.conflict).length * 5, 20);
  return Math.min(Math.round(pct * 0.85) + bonus, 100);
}

function scoreTradeTiming({ tradeEvents }) {
  if (!tradeEvents?.length) return 0;
  const scores = tradeEvents.map(e => {
    const days = (new Date(e.policyDate) - new Date(e.date)) / 86400000;
    if (days <= 0) return 0;
    const t = T.tradeTiming;
    let s;
    if (days <= t.critical)  s = 90 + Math.min((t.critical - days) / t.critical * 10, 10);
    else if (days <= t.high) s = 65 + ((t.high - days) / (t.high - t.critical)) * 25;
    else if (days <= t.moderate) s = 35 + ((t.moderate - days) / (t.moderate - t.high)) * 30;
    else if (days <= t.low) s = 10 + ((t.low - days) / (t.low - t.moderate)) * 25;
    else s = 5;
    return s
      * Math.min(1 + Math.log10(Math.max(e.valueCr, 0.1)) * 0.1, 1.3)
      * (e.isFamilyMember ? 0.8 : 1.0);
  }).sort((a, b) => b - a);
  return Math.min(Math.round(scores[0] + scores.slice(1).reduce((s, v) => s + v * 0.2, 0)), 100);
}

function scoreCaseDisposal({ criminalCases, partyHistory }) {
  if (!criminalCases?.length) return 0;

  // ── If only pending cases (single-year data), score on count alone ───────
  const pending  = criminalCases.filter(c => c.status === "PENDING");
  const resolved = criminalCases.filter(c => ["DROPPED", "ACQUITTED"].includes(c.status) && c.resolvedYear);

  // Score pending cases by count (each serious case adds weight)
  let pendingScore = 0;
  if (pending.length > 0) {
    pendingScore = Math.min(pending.length * 12, 60);
    // Serious cases (IPC 302, 307, corruption etc) flagged in note
    const serious = pending.filter(c =>
      /IPC|302|307|ED|CBI|money launder|disproportionate|benami|murder|rape|kidnap/i.test((c.case || "") + (c.note || ""))
    );
    pendingScore += serious.length * 10;
  }

  // Score dropped/acquitted cases near party switches
  let disposalScore = 0;
  if (resolved.length > 0 && partyHistory?.length > 1) {
    const switchYears = partyHistory.slice(1).map(p => p.from);
    let total = 0, count = 0;
    resolved.forEach(c => {
      const months = switchYears.reduce((m, yr) => Math.min(m, Math.abs((c.resolvedYear - yr) * 12)), Infinity);
      const t = T.caseDisposal;
      let s = months <= t.critical ? 90 : months <= t.high ? 65 : months <= t.moderate ? 35 : 10;
      if (/ED|CBI|money launder|disproportionate|benami/i.test(c.case || "")) s = Math.min(s * 1.2, 100);
      total += s; count++;
    });
    disposalScore = count > 0 ? Math.round(total / count + Math.min((count - 1) * 8, 20)) : 0;
  }

  return Math.min(Math.max(pendingScore, disposalScore), 100);
}

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

function scoreDisclosure({ disclosure }) {
  if (!disclosure) return 0;
  const { lateFilings=0, amendmentsAfterMedia=0, assetsFoundInAudit=0, missingYears=0 } = disclosure;
  return Math.min(lateFilings * 8 + amendmentsAfterMedia * 15 + assetsFoundInAudit * 25 + missingYears * 20, 100);
}

export function scorePolitician(p) {
  const subScores = {
    incomeGap:      scoreIncomeGap(p),
    sectorConflict: scoreSectorConflict(p),
    tradeTiming:    scoreTradeTiming(p),
    caseDisposal:   scoreCaseDisposal(p),
    networkRisk:    scoreNetworkRisk(p),
    disclosure:     scoreDisclosure(p),
  };

  const final = Math.round(
    Object.entries(WEIGHTS).reduce((s, [k, w]) => s + subScores[k] * w, 0)
  );

  const riskLevel = final >= 85 ? "CRITICAL" : final >= 70 ? "HIGH" : final >= 50 ? "MODERATE" : "LOW";

  const flags = [];
  const latestAssets = Object.values(p.totalAssets || {}).pop() || 0;

  if (subScores.incomeGap >= 80)
    flags.push(`Declared wealth ₹${latestAssets}Cr far exceeds what a public salary explains`);
  if (subScores.incomeGap >= 50 && latestAssets > 25)
    flags.push(`Net worth ₹${latestAssets}Cr — significantly above average MP`);
  if (subScores.sectorConflict >= 70)
    flags.push(`Holdings in regulated sectors: ${p.holdings?.filter(h => h.conflict).map(h => h.sector).join(", ")}`);
  if (subScores.tradeTiming >= 70)
    flags.push("Trades occurred close to policy events");
  if (subScores.caseDisposal >= 60)
    flags.push("Criminal cases dropped near party switch dates");
  if ((p.criminalCases?.length || 0) >= 5)
    flags.push(`${p.criminalCases.length} pending criminal cases declared in affidavit`);
  if ((p.criminalCases?.length || 0) >= 1 && (p.criminalCases?.length || 0) < 5)
    flags.push(`${p.criminalCases.length} criminal case${p.criminalCases.length > 1 ? "s" : ""} declared in affidavit`);
  if (subScores.networkRisk >= 60)
    flags.push("Family or associates show suspicious activity");
  if (subScores.disclosure >= 50)
    flags.push("Declaration history shows amendments or hidden assets");

  return { final, subScores, riskLevel, flags };
}

export function scoreBatch(politicians) {
  return politicians
    .map(p => ({ ...p, scoring: scorePolitician(p) }))
    .sort((a, b) => b.scoring.final - a.scoring.final);
}
