// lib/scoring.js — NetaWatch Scoring Engine
// Runs on both server (API routes) and client (live preview)

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
};

function scoreIncomeGap({ totalAssets, declaredIncome }) {
  const years = Object.keys(totalAssets).map(Number).sort();
  if (years.length < 2) return 0;
  const growth   = totalAssets[years[years.length-1]] - totalAssets[years[0]];
  const declared = Object.values(declaredIncome).reduce((a,b)=>a+b,0);
  if (declared <= 0) return 100;
  const ratio = growth / declared;
  const t = T.incomeGap;
  if (ratio <= t.low)      return Math.round((ratio/t.low)*20);
  if (ratio <= t.moderate) return Math.round(20+((ratio-t.low)/(t.moderate-t.low))*25);
  if (ratio <= t.high)     return Math.round(45+((ratio-t.moderate)/(t.high-t.moderate))*25);
  if (ratio <= t.extreme)  return Math.round(70+((ratio-t.high)/(t.extreme-t.high))*20);
  return 95;
}

function scoreSectorConflict({ holdings }) {
  if (!holdings?.length) return 0;
  const total      = holdings.reduce((s,h)=>s+h.value,0);
  const conflicted = holdings.filter(h=>h.conflict).reduce((s,h)=>s+h.value,0);
  const pct        = total>0 ? (conflicted/total)*100 : 0;
  const bonus      = Math.min(holdings.filter(h=>h.conflict).length*5,20);
  return Math.min(Math.round(pct*0.85)+bonus,100);
}

function scoreTradeTiming({ tradeEvents }) {
  if (!tradeEvents?.length) return 0;
  const scores = tradeEvents.map(e=>{
    const days = (new Date(e.policyDate)-new Date(e.date))/86400000;
    if (days<=0) return 0;
    const t = T.tradeTiming;
    let s;
    if (days<=t.critical)  s=90+Math.min((t.critical-days)/t.critical*10,10);
    else if(days<=t.high)  s=65+((t.high-days)/(t.high-t.critical))*25;
    else if(days<=t.moderate) s=35+((t.moderate-days)/(t.moderate-t.high))*30;
    else if(days<=t.low)   s=10+((t.low-days)/(t.low-t.moderate))*25;
    else s=5;
    return s * Math.min(1+Math.log10(Math.max(e.valueCr,0.1))*0.1,1.3)
             * (e.isFamilyMember?0.8:1.0);
  }).sort((a,b)=>b-a);
  return Math.min(Math.round(scores[0]+scores.slice(1).reduce((s,v)=>s+v*0.2,0)),100);
}

function scoreCaseDisposal({ criminalCases, partyHistory }) {
  if (!criminalCases?.length) return 0;
  const switchYears = partyHistory.slice(1).map(p=>p.from);
  let total=0, count=0;
  criminalCases.forEach(c=>{
    if(!["DROPPED","ACQUITTED"].includes(c.status)||!c.resolvedYear) return;
    const months = switchYears.reduce((m,yr)=>Math.min(m,Math.abs((c.resolvedYear-yr)*12)),Infinity);
    const t = T.caseDisposal;
    let s = months<=t.critical?90:months<=t.high?65:months<=t.moderate?35:10;
    if(/ED|CBI|money launder|disproportionate|benami/i.test(c.case||"")) s=Math.min(s*1.2,100);
    total+=s; count++;
  });
  if(!count) return 0;
  return Math.min(Math.round(total/count+Math.min((count-1)*8,20)),100);
}

function scoreNetworkRisk({ network }) {
  if (!network?.length) return 0;
  const PROX={spouse:1.0,child:0.9,sibling:0.7,parent:0.6,associate:0.8,shell_company:1.0};
  let total=0;
  network.forEach(n=>{
    const prox=PROX[n.type]||0.5;
    let s=0;
    if(n.holdingsInConflictSectors) s+=25;
    if(n.tradeBeforePolicy)         s+=35;
    if(n.govtContractWon)           s+=30;
    if(n.govtContractWon&&n.contractValueCr) s+=Math.min(Math.log10(n.contractValueCr)*5,15);
    total+=s*prox;
  });
  return Math.min(Math.round((total/(network.length*100))*150),100);
}

function scoreDisclosure({ disclosure }) {
  if(!disclosure) return 0;
  const {lateFilings=0,amendmentsAfterMedia=0,assetsFoundInAudit=0,missingYears=0}=disclosure;
  return Math.min(lateFilings*8+amendmentsAfterMedia*15+assetsFoundInAudit*25+missingYears*20,100);
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
    Object.entries(WEIGHTS).reduce((s,[k,w])=>s+subScores[k]*w,0)
  );
  const riskLevel = final>=85?"CRITICAL":final>=70?"HIGH":final>=50?"MODERATE":"LOW";
  const flags=[];
  if(subScores.incomeGap>=80)      flags.push("Asset growth far exceeds declared income");
  if(subScores.sectorConflict>=70) flags.push(`Holdings in regulated sectors: ${p.holdings?.filter(h=>h.conflict).map(h=>h.sector).join(", ")}`);
  if(subScores.tradeTiming>=70)    flags.push("Trades occurred close to classified policy events");
  if(subScores.caseDisposal>=60)   flags.push("Criminal cases dropped near party switch dates");
  if(subScores.networkRisk>=60)    flags.push("Family or associates show suspicious activity");
  if(subScores.disclosure>=50)     flags.push("Declaration history shows amendments or hidden assets");
  return { final, subScores, riskLevel, flags };
}

export function scoreBatch(politicians) {
  return politicians
    .map(p=>({...p, scoring: scorePolitician(p)}))
    .sort((a,b)=>b.scoring.final-a.scoring.final);
}
