/**
 * NetaWatch — MyNeta MP Fetcher
 * ==============================
 * Run this ONCE locally to fetch all 543 Lok Sabha MPs from MyNeta.info
 * and save them to public/politicians.json which the app serves statically.
 *
 * Usage:
 *   node scripts/fetch-mps.js
 *
 * Output:
 *   public/politicians.json   ← committed to repo, served by Next.js
 *
 * MyNeta.info is a public interest platform run by ADR (Association for
 * Democratic Reforms). All data is sourced from ECI affidavits.
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

// MyNeta LS2024 JSON API — they expose candidate data as structured tables
// We parse the HTML candidate listing pages per state
const STATES = [
  { id:"S01", name:"Andhra Pradesh"       },
  { id:"S02", name:"Arunachal Pradesh"    },
  { id:"S03", name:"Assam"                },
  { id:"S04", name:"Bihar"                },
  { id:"S05", name:"Chhattisgarh"         },
  { id:"S06", name:"Goa"                  },
  { id:"S07", name:"Gujarat"              },
  { id:"S08", name:"Haryana"              },
  { id:"S09", name:"Himachal Pradesh"     },
  { id:"S10", name:"Jharkhand"            },
  { id:"S11", name:"Karnataka"            },
  { id:"S12", name:"Kerala"               },
  { id:"S13", name:"Madhya Pradesh"       },
  { id:"S14", name:"Maharashtra"          },
  { id:"S15", name:"Manipur"              },
  { id:"S16", name:"Meghalaya"            },
  { id:"S17", name:"Mizoram"              },
  { id:"S18", name:"Nagaland"             },
  { id:"S19", name:"Odisha"               },
  { id:"S20", name:"Punjab"               },
  { id:"S21", name:"Rajasthan"            },
  { id:"S22", name:"Sikkim"               },
  { id:"S23", name:"Tamil Nadu"           },
  { id:"S24", name:"Telangana"            },
  { id:"S25", name:"Tripura"              },
  { id:"S26", name:"Uttar Pradesh"        },
  { id:"S27", name:"Uttarakhand"          },
  { id:"S28", name:"West Bengal"          },
  { id:"S29", name:"Andaman & Nicobar"    },
  { id:"S30", name:"Chandigarh"           },
  { id:"S31", name:"Dadra & NH"           },
  { id:"S32", name:"Delhi"                },
  { id:"S33", name:"Jammu & Kashmir"      },
  { id:"S34", name:"Ladakh"               },
  { id:"S35", name:"Lakshadweep"          },
  { id:"S36", name:"Puducherry"           },
];

const PARTY_COLORS = {
  BJP:  { fg:"#E8450A", bg:"#FFF1EC" },
  INC:  { fg:"#1155AA", bg:"#EEF4FF" },
  AAP:  { fg:"#007A82", bg:"#EDFAFA" },
  TMC:  { fg:"#00695C", bg:"#E0F2F1" },
  SP:   { fg:"#D84315", bg:"#FBE9E7" },
  BSP:  { fg:"#1565C0", bg:"#E3F2FD" },
  NCP:  { fg:"#6B21A8", bg:"#F5F0FF" },
  DMK:  { fg:"#C62828", bg:"#FFEBEE" },
  JDU:  { fg:"#00838F", bg:"#E0F7FA" },
  RJD:  { fg:"#AD1457", bg:"#FCE4EC" },
  IND:  { fg:"#455A64", bg:"#ECEFF1" },
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NetaWatch/1.0)" }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseAmount(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[₹,\s]/g, "");
  const m = cleaned.match(/[\d.]+/);
  if (!m) return 0;
  const val = parseFloat(m[0]);
  // MyNeta shows rupees — convert to crore
  if (val >= 1e7) return Math.round(val / 1e7 * 100) / 100;
  if (val >= 1e5) return Math.round(val / 1e7 * 10000) / 10000;
  return val;
}

function proxyPhoto(name) {
  // Use Wikipedia REST API to get photo, proxied through weserv.nl for CORS
  const slug = encodeURIComponent(name.replace(/ /g, "_"));
  // We return a weserv.nl URL that fetches from Wikipedia on the fly
  return `https://images.weserv.nl/?url=https://en.wikipedia.org/api/rest_v1/page/summary/${slug}&output=json&w=120&h=120&fit=cover&mask=circle`;
}

async function fetchWikipediaPhoto(name) {
  try {
    const slug = name.replace(/ /g, "_");
    const data = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`);
    const json = JSON.parse(data);
    const thumb = json?.thumbnail?.source;
    if (thumb) {
      return `https://images.weserv.nl/?url=${encodeURIComponent(thumb)}&w=120&h=120&fit=cover&mask=circle`;
    }
  } catch (e) {}
  return "";
}

async function fetchStateMP(stateId, stateName) {
  console.log(`  Fetching ${stateName}...`);
  const url = `https://www.myneta.info/ls2024/index.php?action=summary&subAction=candidates_by_state&state_id=${stateId}`;
  
  try {
    const html = await fetch(url);
    const rows = [];

    // Parse table rows
    const tableMatch = html.match(/<table[^>]*class="[^"]*w3-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return rows;

    const rowMatches = tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    let isFirst = true;

    for (const rowMatch of rowMatches) {
      if (isFirst) { isFirst = false; continue; } // skip header
      
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, "").trim());
      
      if (cells.length < 4) continue;
      
      // Extract name from link
      const nameMatch = rowMatch[1].match(/href="([^"]+)"[^>]*>([^<]+)</);
      if (!nameMatch) continue;
      
      const name         = cells[1] || nameMatch[2] || "";
      const constituency = cells[2] || "";
      const party        = (cells[3] || "IND").toUpperCase().trim();
      const assets       = parseAmount(cells[4] || "0");
      const liabilities  = parseAmount(cells[5] || "0");
      const casesText    = cells[6] || "0";
      const casesCount   = parseInt(casesText.match(/\d+/)?.[0] || "0");

      if (!name || name.length < 2) continue;

      rows.push({ name, constituency, party, assets, liabilities, casesCount, stateName });
    }

    return rows;
  } catch (e) {
    console.warn(`  Failed ${stateName}: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("━━━ NetaWatch — Fetching all 543 MPs from MyNeta ━━━");
  
  const all = [];
  
  for (const state of STATES) {
    const mps = await fetchStateMP(state.id, state.name);
    all.push(...mps);
    console.log(`  → ${state.name}: ${mps.length} MPs`);
    await sleep(1200); // respectful rate limit
  }

  console.log(`\nTotal MPs fetched: ${all.length}`);
  console.log("Fetching Wikipedia photos (this takes ~10 min for 543 MPs)...");

  // Build politician objects with Wikipedia photos
  const politicians = [];
  for (let i = 0; i < all.length; i++) {
    const mp = all[i];
    
    // Get photo every 3rd politician to keep things fast, others get initials
    // Remove this condition to get all photos (slower)
    const photo = await fetchWikipediaPhoto(mp.name);
    await sleep(200);

    if (i % 50 === 0) console.log(`  Photos: ${i}/${all.length}`);

    politicians.push({
      id:           String(i + 1),
      name:         mp.name,
      party:        mp.party,
      state:        mp.stateName,
      constituency: mp.constituency,
      role:         `MP · ${mp.constituency}`,
      age:          0,
      photo,

      // Scoring engine inputs
      totalAssets:    { "2024": mp.assets },
      liabilities:    { "2024": mp.liabilities },
      declaredIncome: { "2024": 0 },
      holdings:       [],
      tradeEvents:    [],

      criminalCases: Array.from({ length: mp.casesCount }, (_, j) => ({
        case:         `Pending case ${j + 1}`,
        status:       "PENDING",
        resolvedYear: null,
        note:         "Details available in ECI affidavit",
      })),

      partyHistory: [{ party: mp.party, from: 2024, to: 2024 }],
      network:      [],
      disclosure:   { lateFilings:0, amendmentsAfterMedia:0, assetsFoundInAudit:0, missingYears:0 },
      timeline:     [],
    });
  }

  // Save to public folder so Next.js serves it statically
  const outDir = path.join(__dirname, "..", "public");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "politicians.json");
  fs.writeFileSync(outPath, JSON.stringify(politicians, null, 2));

  console.log(`\n✅ Saved ${politicians.length} politicians to public/politicians.json`);
  console.log("Now commit and push — Vercel will serve the data automatically.");
}

main().catch(console.error);
