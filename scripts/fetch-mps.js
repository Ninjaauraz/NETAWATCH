/**
 * NetaWatch — Working MyNeta Scraper
 * Run: node fetch-mps.js
 * Output: politicians.json  (upload to GitHub → public/politicians.json)
 */

const https = require("https");
const fs    = require("fs");

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseRupees(text) {
  if (!text) return 0;
  // "Rs 3,09,16,833  ~ 3 Crore+" → parse the actual number
  const clean = text.replace(/[Rs,\s]/g, "");
  const m = clean.match(/[\d.]+/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  if (n >= 1e7) return Math.round(n / 1e7 * 100) / 100;   // rupees → crore
  if (n >= 1e5) return Math.round(n / 1e7 * 1e4) / 1e4;   // lakhs
  return Math.round(n * 100) / 100;
}

function parseRows(html) {
  const politicians = [];

  // Extract all table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowNum = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    rowNum++;
    const row = rowMatch[1];
    
    // Skip header rows
    if (row.includes("<th") || row.includes("Candidate") && row.includes("Party") && row.includes("Assets")) continue;

    // Extract cells
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      // Strip HTML tags and clean
      const text = cellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      cells.push(text);
    }

    if (cells.length < 5) continue;

    // Extract candidate name and URL from the name cell (cell index 1)
    const nameCellHtml = (() => {
      const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      return cellMatches[1]?.[1] || "";
    })();

    // Get href
    const hrefMatch = nameCellHtml.match(/href="([^"]+candidate[^"]+)"/i);
    const candidateUrl = hrefMatch ? hrefMatch[1] : "";
    const candidateId  = (candidateUrl.match(/candidate_id=(\d+)/) || [])[1] || String(rowNum);

    // Clean name — remove duplicate link text
    const nameRaw  = cells[1] || "";
    const nameParts = nameRaw.split(/\s{2,}/);
    const name      = nameParts[nameParts.length - 1].trim() || nameParts[0].trim();

    if (!name || name.length < 2 || /^\d+$/.test(name)) continue;

    const sno          = cells[0] || "";
    const constituency = (cells[2] || "").trim();
    const party        = (cells[3] || "IND").trim().toUpperCase()
      .replace("AITC", "TMC")
      .replace("NATIONALIST CONGRESS PARTY – SHARADCHANDRA PAWAR", "NCP(SP)")
      .replace("INDIAN NATIONAL CONGRESS", "INC")
      .replace("BHARATIYA JANATA PARTY", "BJP");

    // Shorten long party names
    const partyShort = party.length > 8 
      ? party.split(/[\s\-–]+/)[0].slice(0, 8)
      : party;

    const casesText   = (cells[4] || "0").trim();
    const casesCount  = parseInt(casesText.replace(/[^0-9]/g, "") || "0");
    const education   = (cells[5] || "").trim();
    const assetsText  = cells[6] || "";
    const liabText    = cells[7] || "";

    const assets = parseRupees(assetsText);
    const liab   = parseRupees(liabText);

    // Determine state from constituency (we'll assign after)
    politicians.push({
      id:           candidateId,
      name,
      party:        partyShort,
      partyFull:    party,
      constituency,
      state:        "",   // filled in below
      role:         `MP · ${constituency}`,
      age:          0,
      photo:        "",   // filled in below
      education,
      totalAssets:    { "2024": assets },
      liabilities:    { "2024": liab   },
      declaredIncome: { "2024": 0      },
      holdings:       [],
      tradeEvents:    [],
      criminalCases:  Array.from({ length: casesCount }, (_, i) => ({
        case:         `Pending criminal case ${i + 1}`,
        status:       "PENDING",
        resolvedYear: null,
        note:         `Declared in 2024 Lok Sabha affidavit`,
      })),
      partyHistory: [{ party: partyShort, from: 2024, to: 2024 }],
      network:      [],
      disclosure:   { lateFilings:0, amendmentsAfterMedia:0, assetsFoundInAudit:0, missingYears:0 },
      timeline:     [],
    });
  }

  return politicians;
}

// Map constituency → state
const CONSTITUENCY_STATE = {
  "ADILABAD":"Andhra Pradesh","ARUNACHAL":"Arunachal Pradesh","ASSAM":"Assam",
  "BIHAR":"Bihar","CHHATTISGARH":"Chhattisgarh","GOA":"Goa","GUJARAT":"Gujarat",
  "HARYANA":"Haryana","HIMACHAL":"Himachal Pradesh","JHARKHAND":"Jharkhand",
  "KARNATAKA":"Karnataka","KERALA":"Kerala","MADHYA PRADESH":"Madhya Pradesh",
  "MAHARASHTRA":"Maharashtra","MANIPUR":"Manipur","MEGHALAYA":"Meghalaya",
  "MIZORAM":"Mizoram","NAGALAND":"Nagaland","ODISHA":"Odisha","PUNJAB":"Punjab",
  "RAJASTHAN":"Rajasthan","SIKKIM":"Sikkim","TAMIL":"Tamil Nadu","TELANGANA":"Telangana",
  "TRIPURA":"Tripura","UTTAR PRADESH":"Uttar Pradesh","UTTARAKHAND":"Uttarakhand",
  "WEST BENGAL":"West Bengal","DELHI":"Delhi","ANDAMAN":"Andaman & Nicobar",
  "CHANDIGARH":"Chandigarh","PUDUCHERRY":"Puducherry","LADAKH":"Ladakh",
  "JAMMU":"Jammu & Kashmir","LAKSHADWEEP":"Lakshadweep",
};

// More precise state mapping by known constituencies
const KNOWN_STATES = {
  "VARANASI":"Uttar Pradesh","AMETHI":"Uttar Pradesh","LUCKNOW":"Uttar Pradesh",
  "GANDHINAGAR":"Gujarat","AHMEDABAD EAST":"Gujarat","AHMEDABAD WEST (SC)":"Gujarat",
  "THIRUVANANTHAPURAM":"Kerala","WAYANAD":"Kerala","ALATHUR (SC)":"Kerala",
  "MUMBAI NORTH":"Maharashtra","MUMBAI SOUTH":"Maharashtra","PUNE":"Maharashtra",
  "BARAMATI":"Maharashtra","AURANGABAD":"Maharashtra",
  "BANGALORE CENTRAL":"Karnataka","BANGALORE NORTH":"Karnataka","BANGALORE SOUTH":"Karnataka",
  "BANGALORE RURAL":"Karnataka","BAGALKOT":"Karnataka",
  "ALWAR":"Rajasthan","AJMER":"Rajasthan","BARMER":"Rajasthan","JODHPUR":"Rajasthan",
  "NEW DELHI":"Delhi","CHANDNI CHOWK":"Delhi","EAST DELHI":"Delhi","NORTH EAST DELHI":"Delhi",
  "NORTH WEST DELHI (SC)":"Delhi","SOUTH DELHI":"Delhi","WEST DELHI":"Delhi",
  "PATNA SAHIB":"Bihar","BEGUSARAI":"Bihar","MUZAFFARPUR":"Bihar","AURANGABAD":"Bihar",
  "KOLKATA NORTH":"West Bengal","KOLKATA SOUTH":"West Bengal","JADAVPUR":"West Bengal",
  "BURDWAN-DURGAPUR":"West Bengal","BANKURA":"West Bengal","BARASAT":"West Bengal",
  "CHENNAI CENTRAL":"Tamil Nadu","CHENNAI NORTH":"Tamil Nadu","CHENNAI SOUTH":"Tamil Nadu",
  "COIMBATORE":"Tamil Nadu","MADURAI":"Tamil Nadu","SALEM":"Tamil Nadu",
  "HYDERABAD":"Telangana","SECUNDERABAD":"Telangana","CHEVELLA":"Telangana",
  "ADILABAD (ST)":"Telangana","KARIMNAGAR":"Telangana","WARANGAL (SC)":"Telangana",
  "AGRA (SC)":"Uttar Pradesh","ALIGARH":"Uttar Pradesh","ALLAHABAD":"Uttar Pradesh",
  "AMROHA":"Uttar Pradesh","AONLA":"Uttar Pradesh","AZAMGARH":"Uttar Pradesh",
  "BAGHPAT":"Uttar Pradesh","BAHRAICH (SC)":"Uttar Pradesh","BALLIA":"Uttar Pradesh",
  "BANDA":"Uttar Pradesh","BARABANKI (SC)":"Uttar Pradesh","AMRITSAR":"Punjab",
  "ANANDPUR SAHIB":"Punjab","LUDHIANA":"Punjab","GURDASPUR":"Punjab",
  "ALMORA (SC)":"Uttarakhand","PAURI GARHWAL":"Uttarakhand","TEHRI GARHWAL":"Uttarakhand",
  "AMBALA (SC)":"Haryana","BHIWANI-MAHENDRAGARH":"Haryana","FARIDABAD":"Haryana",
  "AMALAPURAM (SC)":"Andhra Pradesh","ANAKAPALLE":"Andhra Pradesh","ARAKU (ST)":"Andhra Pradesh",
  "BAPATLA (SC)":"Andhra Pradesh","ARANI":"Tamil Nadu","ARAKKONAM":"Tamil Nadu",
  "ARAMBAG (SC)":"West Bengal","ASANSOL":"West Bengal","BALAGHAT":"Madhya Pradesh",
  "BALASORE":"Odisha","BARGARH":"Odisha","ASKA":"Odisha","BANKA":"Bihar",
  "BANSWARA (ST)":"Rajasthan","BARPETA":"Assam","BARRACKPUR":"West Bengal",
  "BASIRHAT":"West Bengal","BASTAR (ST)":"Chhattisgarh","ANDAMAN AND NICOBAR ISLANDS":"Andaman & Nicobar",
  "ANANTNAG-RAJOURI":"Jammu & Kashmir","BARAMULLA":"Jammu & Kashmir",
  "ALIPURDUARS (ST)":"West Bengal","BANGAON (SC)":"West Bengal","BALURGHAT":"West Bengal",
  "BARDHAMAN PURBA (SC)":"West Bengal",
};

function guessState(constituency) {
  if (KNOWN_STATES[constituency]) return KNOWN_STATES[constituency];
  const upper = constituency.toUpperCase();
  for (const [key, state] of Object.entries(CONSTITUENCY_STATE)) {
    if (upper.includes(key)) return state;
  }
  return "India";
}

async function getWikipediaPhoto(name) {
  try {
    const slug = encodeURIComponent(name.replace(/ /g, "_"));
    const data = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
    const json = JSON.parse(data);
    const thumb = json?.thumbnail?.source;
    if (thumb) {
      return `https://images.weserv.nl/?url=${encodeURIComponent(thumb)}&w=120&h=120&fit=cover&mask=circle`;
    }
  } catch (e) {}
  return "";
}

async function main() {
  console.log("━━━ NetaWatch — Fetching 543 Lok Sabha 2024 Winners ━━━");
  console.log("Source: myneta.info/LokSabha2024 (ECI affidavit data)\n");

  const url = "https://www.myneta.info/LokSabha2024/index.php?action=show_winners&sort=candidate";
  
  console.log("Fetching winners list...");
  let html;
  try {
    html = await get(url);
  } catch (e) {
    console.error("Failed to fetch MyNeta:", e.message);
    process.exit(1);
  }

  if (!html || html.length < 1000) {
    console.error("Got empty response. Check your internet connection.");
    process.exit(1);
  }

  console.log(`Got ${html.length} bytes of HTML`);

  const politicians = parseRows(html);
  console.log(`Parsed ${politicians.length} MPs\n`);

  if (politicians.length === 0) {
    console.error("No MPs parsed. Saving raw HTML for debugging...");
    fs.writeFileSync("debug.html", html);
    console.log("Saved debug.html — open it in browser to inspect");
    process.exit(1);
  }

  // Assign states
  politicians.forEach(p => {
    p.state = guessState(p.constituency);
  });

  // Get Wikipedia photos for top 50 most prominent politicians
  // (getting all 543 photos takes ~30 min, this gets the most visible ones fast)
  const prominent = [
    "Narendra Modi", "Rahul Gandhi", "Amit Shah", "Arvind Kejriwal",
    "Mamata Banerjee", "Nirmala Sitharaman", "Rajnath Singh", "S Jaishankar",
    "Smriti Irani", "Akhilesh Yadav", "Supriya Sule", "Kiren Rijiju",
    "Tejasvi Surya", "Shashi Tharoor", "Omar Abdullah", "Chirag Paswan",
    "Nitin Gadkari", "Piyush Goyal", "Dharmendra Pradhan",
  ];

  console.log("Fetching Wikipedia photos for prominent MPs...");
  for (const p of politicians) {
    if (prominent.some(n => p.name.toLowerCase().includes(n.toLowerCase().split(" ")[1] || n.toLowerCase()))) {
      p.photo = await getWikipediaPhoto(p.name);
      if (p.photo) console.log(`  ✓ Photo: ${p.name}`);
      await sleep(300);
    }
  }

  // Save output
  fs.writeFileSync("politicians.json", JSON.stringify(politicians, null, 2));
  
  console.log(`\n✅ Saved ${politicians.length} politicians to politicians.json`);
  console.log("\nNext step:");
  console.log("  1. On GitHub, create a 'public' folder");
  console.log("  2. Upload politicians.json into the public/ folder");
  console.log("  3. Vercel auto-redeploys — site now shows all 543 MPs!");
  
  // Print sample
  console.log("\nSample (first 5 MPs):");
  politicians.slice(0, 5).forEach(p => {
    console.log(`  ${p.name} | ${p.party} | ${p.constituency} | ₹${p.totalAssets["2024"]}Cr | ${p.criminalCases.length} cases`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
