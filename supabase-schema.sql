-- NetaWatch · Supabase Schema
-- Run this in your Supabase project: Dashboard → SQL Editor → New Query

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Politicians table ────────────────────────────────────────────────────────
create table if not exists politicians (
  id              text primary key default uuid_generate_v4()::text,
  name            text not null,
  party           text,
  state           text,
  constituency    text,
  role            text,
  age             int,

  -- Scoring engine inputs (stored as JSONB)
  total_assets    jsonb default '{}',   -- { "2009": 1.8, "2024": 64.3 }
  liabilities     jsonb default '{}',
  declared_income jsonb default '{}',
  holdings        jsonb default '[]',
  trade_events    jsonb default '[]',
  criminal_cases  jsonb default '[]',
  party_history   jsonb default '[]',
  network         jsonb default '[]',
  disclosure      jsonb default '{}',
  timeline        jsonb default '[]',

  -- Meta
  parse_confidence  float default 0,
  pdf_url           text,
  last_updated      timestamptz default now(),
  created_at        timestamptz default now()
);

-- Rename snake_case columns to camelCase for JS compatibility
-- (Next.js will receive these as-is from Supabase)
comment on column politicians.total_assets    is 'totalAssets';
comment on column politicians.declared_income is 'declaredIncome';
comment on column politicians.criminal_cases  is 'criminalCases';
comment on column politicians.trade_events    is 'tradeEvents';
comment on column politicians.party_history   is 'partyHistory';

-- Index for fast search
create index if not exists idx_politicians_name  on politicians(name);
create index if not exists idx_politicians_party on politicians(party);
create index if not exists idx_politicians_state on politicians(state);

-- ── Enable Row Level Security (public read) ──────────────────────────────────
alter table politicians enable row level security;

create policy "Public read access"
  on politicians for select
  using (true);

-- ── Seed the 3 demo politicians ─────────────────────────────────────────────
insert into politicians (
  id, name, party, state, constituency, role, age,
  total_assets, liabilities, declared_income,
  holdings, trade_events, criminal_cases,
  party_history, network, disclosure, timeline
) values
(
  '1', 'Arvind Mehta', 'BJP', 'Maharashtra', 'Mumbai North',
  'Minister of Telecommunications', 54,
  '{"2009":1.8,"2014":4.2,"2019":18.7,"2024":64.3}',
  '{"2009":0.4,"2014":1.1,"2019":3.2,"2024":6.8}',
  '{"2019":0.42,"2020":0.48,"2021":0.51,"2022":0.55,"2023":0.58}',
  '[{"sector":"Telecom","value":28.4,"conflict":true},{"sector":"Real Estate","value":19.6,"conflict":false},{"sector":"Banking","value":16.3,"conflict":false}]',
  '[{"date":"2018-04-01","policyDate":"2018-09-01","isFamilyMember":false,"valueCr":8},{"date":"2017-11-01","policyDate":"2018-09-01","isFamilyMember":true,"valueCr":6}]',
  '[{"case":"Land encroachment FIR","status":"DROPPED","resolvedYear":2017,"note":"Dropped 1yr after joining BJP"},{"case":"Money laundering (ED)","status":"DROPPED","resolvedYear":2017,"note":"Dropped same year as party switch"},{"case":"Disproportionate assets","status":"ACQUITTED","resolvedYear":2019,"note":"Acquitted pre-election"}]',
  '[{"party":"INC","from":2004,"to":2012},{"party":"NCP","from":2012,"to":2016},{"party":"BJP","from":2016,"to":2024}]',
  '[{"name":"Sunita Mehta","type":"spouse","holdingsInConflictSectors":true,"tradeBeforePolicy":true,"govtContractWon":false},{"name":"Rohan Mehta","type":"child","holdingsInConflictSectors":false,"tradeBeforePolicy":false,"govtContractWon":true,"contractValueCr":22},{"name":"Vijay Contractors Ltd","type":"shell_company","holdingsInConflictSectors":false,"tradeBeforePolicy":false,"govtContractWon":true,"contractValueCr":340}]',
  '{"lateFilings":0,"amendmentsAfterMedia":1,"assetsFoundInAudit":1,"missingYears":0}',
  '[{"date":"Jan 2016","event":"Joined BJP from NCP","type":"party"},{"date":"Mar 2016","event":"ED case dropped within 60 days","type":"legal","flag":true},{"date":"Aug 2017","event":"Appointed Telecom Minister","type":"appt"},{"date":"Nov 2017","event":"Spouse buys Airtel ₹6Cr","type":"trade","flag":true},{"date":"Sep 2018","event":"5G policy publicly announced","type":"policy"},{"date":"Dec 2018","event":"Airtel +34% family gain ₹4.9Cr","type":"gain","flag":true}]'
),
(
  '2', 'Priya Nair', 'INC', 'Kerala', 'Thiruvananthapuram',
  'Minister of Pharmaceuticals', 47,
  '{"2009":0.8,"2014":2.1,"2019":9.4,"2024":31.8}',
  '{"2009":0.2,"2014":0.5,"2019":1.8,"2024":4.1}',
  '{"2019":0.38,"2020":0.41,"2021":0.44,"2022":0.47,"2023":0.50}',
  '[{"sector":"Pharma","value":14.2,"conflict":true},{"sector":"Healthcare","value":9.1,"conflict":true},{"sector":"FMCG","value":8.5,"conflict":false}]',
  '[{"date":"2021-02-01","policyDate":"2021-04-01","isFamilyMember":true,"valueCr":5}]',
  '[{"case":"Misuse of public funds (CAG)","status":"PENDING","resolvedYear":null,"note":"No hearing in 8 years"}]',
  '[{"party":"AAP","from":2013,"to":2018},{"party":"INC","from":2018,"to":2024}]',
  '[{"name":"Anand Nair","type":"spouse","holdingsInConflictSectors":true,"tradeBeforePolicy":true,"govtContractWon":false},{"name":"Dr. Anil Nair","type":"sibling","holdingsInConflictSectors":true,"tradeBeforePolicy":true,"govtContractWon":true,"contractValueCr":180}]',
  '{"lateFilings":1,"amendmentsAfterMedia":0,"assetsFoundInAudit":0,"missingYears":0}',
  '[{"date":"Dec 2019","event":"Appointed Pharma Minister","type":"appt"},{"date":"Feb 2021","event":"Husband buys Sun Pharma ₹5Cr","type":"trade","flag":true},{"date":"Apr 2021","event":"Vaccine rollout announced","type":"policy"},{"date":"Jul 2021","event":"Sun Pharma +28% gain ₹1.4Cr","type":"gain","flag":true}]'
),
(
  '3', 'Ramesh Patil', 'NCP', 'Maharashtra', 'Pune Rural',
  'Minister of Infrastructure', 61,
  '{"2009":5.2,"2014":8.6,"2019":22.1,"2024":41.0}',
  '{"2009":1.1,"2014":2.3,"2019":5.6,"2024":9.2}',
  '{"2019":0.55,"2020":0.60,"2021":0.62,"2022":0.65,"2023":0.70}',
  '[{"sector":"Construction","value":11.3,"conflict":true},{"sector":"Cement","value":9.8,"conflict":true},{"sector":"Banking","value":19.9,"conflict":false}]',
  '[{"date":"2018-09-01","policyDate":"2018-12-01","isFamilyMember":false,"valueCr":4}]',
  '[{"case":"Illegal mining FIR","status":"DROPPED","resolvedYear":2009,"note":"Dropped after INC switch"},{"case":"Tender fraud (CBI)","status":"DROPPED","resolvedYear":2017,"note":"Dropped after 8 years"},{"case":"Benami property","status":"DROPPED","resolvedYear":2017,"note":"Dropped same year as NCP switch"},{"case":"Forest land encroachment","status":"PENDING","resolvedYear":null,"note":"Stalled since 2018"}]',
  '[{"party":"BJP","from":2002,"to":2008},{"party":"INC","from":2008,"to":2016},{"party":"NCP","from":2016,"to":2024}]',
  '[{"name":"Sushma Patil","type":"spouse","holdingsInConflictSectors":true,"tradeBeforePolicy":false,"govtContractWon":false},{"name":"BuildRight Infra","type":"associate","holdingsInConflictSectors":false,"tradeBeforePolicy":false,"govtContractWon":true,"contractValueCr":820}]',
  '{"lateFilings":0,"amendmentsAfterMedia":0,"assetsFoundInAudit":1,"missingYears":0}',
  '[{"date":"Feb 2016","event":"Joined NCP from INC","type":"party"},{"date":"Mar 2017","event":"3 cases dropped same quarter","type":"legal","flag":true},{"date":"Jul 2018","event":"Appointed Infrastructure Minister","type":"appt"},{"date":"Mar 2019","event":"BuildRight wins ₹820Cr tenders","type":"contract","flag":true}]'
)
on conflict (id) do nothing;
