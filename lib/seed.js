"""
NetaWatch — ECI Affidavit Scraper & Parser
==========================================
Two jobs:
  1. SCRAPER  — finds and downloads affidavit PDFs from ECI / MyNeta
  2. PARSER   — extracts structured numbers from those PDFs

Output: a JSON file per politician in the exact format
        the scoring engine (scoring-engine.js) expects.

Install dependencies:
    pip install requests beautifulsoup4 pdfplumber camelot-py[cv] opencv-python

Run:
    python scraper.py --name "Arvind Kejriwal" --constituency "New Delhi"
    python scraper.py --batch candidates.csv
"""

import os
import re
import json
import time
import logging
import argparse
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

import requests
from bs4 import BeautifulSoup

# pdfplumber is the best free PDF text extractor for affidavits
try:
    import pdfplumber
except ImportError:
    print("Run: pip install pdfplumber")

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("netawatch")

# ─── CONFIG ──────────────────────────────────────────────────────────────────

BASE_MYNETA    = "https://www.myneta.info"
BASE_ECI       = "https://affidavit.eci.gov.in"
HEADERS        = {
    "User-Agent": "Mozilla/5.0 (compatible; NetaWatch-Research-Bot/1.0; "
                  "+https://github.com/your-repo)"
}
DOWNLOAD_DIR   = Path("data/pdfs")
OUTPUT_DIR     = Path("data/parsed")
RATE_LIMIT_SEC = 2          # be respectful — wait 2s between requests
MAX_RETRIES    = 3

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ─── DATA STRUCTURES ─────────────────────────────────────────────────────────

@dataclass
class ParsedAffidavit:
    """
    Mirrors the data shape the JS scoring engine expects.
    Every field maps directly to a scoring dimension.
    """
    politician_name:  str = ""
    party:            str = ""
    constituency:     str = ""
    state:            str = ""
    election_year:    int = 0

    # Dimension 1 — Income Gap
    total_assets_cr:      float = 0.0
    total_liabilities_cr: float = 0.0
    movable_assets_cr:    float = 0.0
    immovable_assets_cr:  float = 0.0
    self_income_cr:       float = 0.0
    spouse_income_cr:     float = 0.0

    # Dimension 2 — Holdings (filled by enrichment step)
    holdings: list = field(default_factory=list)
    # e.g. [{ "sector": "Telecom", "value": 12.4, "conflict": True }]

    # Dimension 3 — Trade Events (filled by enrichment step)
    trade_events: list = field(default_factory=list)

    # Dimension 4 — Criminal Cases
    criminal_cases: list = field(default_factory=list)
    # e.g. [{ "case": "...", "status": "PENDING", "resolvedYear": null }]

    # Dimension 5 — Network (filled by enrichment step)
    network: list = field(default_factory=list)

    # Dimension 6 — Disclosure
    disclosure: dict = field(default_factory=lambda: {
        "lateFilings": 0,
        "amendmentsAfterMedia": 0,
        "assetsFoundInAudit": 0,
        "missingYears": 0,
    })

    # Meta
    pdf_url:    str = ""
    parse_confidence: float = 0.0   # 0–1, how confident the parser is
    raw_text_snippet: str = ""      # first 500 chars for debugging


# ─── SCRAPER ─────────────────────────────────────────────────────────────────

class ECIScraper:
    """
    Searches MyNeta.info (which mirrors ECI affidavit data) for a
    politician, finds their affidavit PDF links, and downloads them.

    MyNeta is the most reliable public mirror of ECI affidavit data
    and is widely used by journalists and researchers.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def _get(self, url: str, **kwargs) -> Optional[requests.Response]:
        """GET with retries and rate limiting."""
        for attempt in range(MAX_RETRIES):
            try:
                time.sleep(RATE_LIMIT_SEC)
                r = self.session.get(url, timeout=15, **kwargs)
                r.raise_for_status()
                return r
            except requests.RequestException as e:
                log.warning(f"Attempt {attempt+1}/{MAX_RETRIES} failed for {url}: {e}")
        log.error(f"All retries failed for {url}")
        return None

    def search_politician(self, name: str, state: str = "",
                          year: int = 2024) -> list[dict]:
        """
        Search MyNeta for a politician by name.
        Returns a list of candidate matches with their affidavit URLs.

        MyNeta URL pattern:
        https://www.myneta.info/{state_slug}{year}/index.php?action=show_candidates
        """
        log.info(f"Searching for: {name} | State: {state} | Year: {year}")

        # MyNeta organises by election year + state
        state_slug = self._state_to_slug(state, year)
        search_url = f"{BASE_MYNETA}/{state_slug}/index.php"

        params = {
            "action":   "search_by_candidate",
            "candidate": name,
        }

        resp = self._get(search_url, params=params)
        if not resp:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        return self._parse_search_results(soup, state_slug)

    def _parse_search_results(self, soup: BeautifulSoup,
                               state_slug: str) -> list[dict]:
        """Extract candidate rows from MyNeta search results page."""
        candidates = []
        table = soup.find("table", {"class": "w3-table-all"})
        if not table:
            log.warning("No results table found — page structure may have changed")
            return candidates

        for row in table.find_all("tr")[1:]:   # skip header row
            cols = row.find_all("td")
            if len(cols) < 5:
                continue
            link = cols[1].find("a")
            if not link:
                continue
            candidates.append({
                "name":         link.text.strip(),
                "constituency": cols[2].text.strip(),
                "party":        cols[3].text.strip(),
                "affidavit_url": BASE_MYNETA + "/" + state_slug + "/" +
                                 link.get("href", ""),
            })

        log.info(f"Found {len(candidates)} candidate(s)")
        return candidates

    def get_affidavit_pdf_url(self, candidate_page_url: str) -> Optional[str]:
        """
        Visit a candidate's MyNeta page and extract the direct PDF link.
        The PDF is the official ECI affidavit form (Form 26).
        """
        resp = self._get(candidate_page_url)
        if not resp:
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # Look for PDF links — MyNeta labels them "View Affidavit"
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.text.strip().lower()
            if "affidavit" in text and href.endswith(".pdf"):
                if href.startswith("http"):
                    return href
                return BASE_MYNETA + href

        # Fallback: any PDF link on the page
        for a in soup.find_all("a", href=True):
            if a["href"].endswith(".pdf"):
                return a["href"] if a["href"].startswith("http") \
                       else BASE_MYNETA + a["href"]

        log.warning(f"No PDF found at {candidate_page_url}")
        return None

    def download_pdf(self, pdf_url: str, filename: str) -> Optional[Path]:
        """Download a PDF and save it locally."""
        save_path = DOWNLOAD_DIR / filename
        if save_path.exists():
            log.info(f"Already downloaded: {filename}")
            return save_path

        log.info(f"Downloading: {pdf_url}")
        resp = self._get(pdf_url)
        if not resp:
            return None

        save_path.write_bytes(resp.content)
        log.info(f"Saved to: {save_path}")
        return save_path

    def _state_to_slug(self, state: str, year: int) -> str:
        """
        Convert state name to MyNeta URL slug.
        e.g. "Maharashtra" + 2024 → "ls2024"  (Lok Sabha)
             "Maharashtra" + 2019 → "ls2019"
        MyNeta uses ls{year} for Lok Sabha elections.
        """
        # For state assembly elections the slug is different,
        # but Lok Sabha is the primary use case here.
        return f"ls{year}"


# ─── PARSER ──────────────────────────────────────────────────────────────────

class AffidavitParser:
    """
    Extracts structured data from ECI Form 26 affidavit PDFs.

    ECI affidavits follow a semi-standard format but vary significantly
    between years and states (typed vs scanned, Hindi vs English, etc).

    Strategy:
      1. Try pdfplumber for text extraction (works on digital PDFs)
      2. Fall back to OCR hint if text extraction yields < 100 chars
      3. Apply regex patterns tuned to Form 26 section headers

    Confidence score: 1.0 = all key fields found cleanly
                      0.5 = some fields missing or ambiguous
                      0.0 = extraction failed
    """

    # ── Regex patterns for Form 26 sections ──────────────────────────────────
    # These are tuned to the standard ECI Form 26 English template.
    # They may need adjustment for regional language versions.

    PATTERNS = {
        # Total assets line — appears near "TOTAL ASSETS" header
        "total_assets": [
            r"(?:total\s+assets?)[^\d]*([\d,]+(?:\.\d+)?)\s*(?:crore|lakh|rs\.?)?",
            r"net\s+worth[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:A\+B)[^\d]*([\d,]+(?:\.\d+)?)",        # Form 26 section A+B
        ],
        # Total liabilities
        "total_liabilities": [
            r"(?:total\s+liabilit(?:ies|y))[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:loans?\s+(?:taken|outstanding))[^\d]*([\d,]+(?:\.\d+)?)",
        ],
        # Movable assets
        "movable_assets": [
            r"(?:movable\s+assets?)[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:section\s+a)[^\d]*([\d,]+(?:\.\d+)?)",
        ],
        # Immovable assets
        "immovable_assets": [
            r"(?:immovable\s+assets?)[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:section\s+b)[^\d]*([\d,]+(?:\.\d+)?)",
        ],
        # Self income
        "self_income": [
            r"(?:income\s+of\s+self)[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:annual\s+income)[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:salary|income)[^\d]*([\d,]+(?:\.\d+)?)",
        ],
        # Spouse income
        "spouse_income": [
            r"(?:income\s+of\s+spouse)[^\d]*([\d,]+(?:\.\d+)?)",
            r"(?:spouse.*?income)[^\d]*([\d,]+(?:\.\d+)?)",
        ],
        # Candidate name
        "name": [
            r"(?:name\s+of\s+(?:the\s+)?candidate)[^\w]*([\w\s]+?)(?:\n|father|husband)",
            r"(?:i,?\s+)([\w\s]{5,50})(?:\s+,?\s+son|\s+,?\s+daughter|\s+,?\s+wife)",
        ],
        # Party
        "party": [
            r"(?:party)[^\w]*([\w\s\(\)]{2,50})(?:\n|constituency)",
        ],
    }

    # Criminal case section markers
    CRIMINAL_SECTION_MARKERS = [
        "criminal antecedents",
        "cases pending",
        "criminal cases",
        "section 8",
        "convicted",
        "pending trial",
    ]

    def parse(self, pdf_path: Path) -> ParsedAffidavit:
        """Main entry point — parse a PDF into a ParsedAffidavit."""
        result = ParsedAffidavit()
        result.pdf_url = str(pdf_path)

        try:
            text = self._extract_text(pdf_path)
        except Exception as e:
            log.error(f"Text extraction failed for {pdf_path}: {e}")
            result.parse_confidence = 0.0
            return result

        if not text or len(text) < 100:
            log.warning(f"Very little text extracted from {pdf_path} — "
                        "PDF may be scanned. OCR required.")
            result.parse_confidence = 0.0
            result.raw_text_snippet = text[:500] if text else ""
            return result

        result.raw_text_snippet = text[:500]
        text_lower = text.lower()

        # Extract each field
        result.total_assets_cr      = self._extract_amount(text_lower, "total_assets")
        result.total_liabilities_cr = self._extract_amount(text_lower, "total_liabilities")
        result.movable_assets_cr    = self._extract_amount(text_lower, "movable_assets")
        result.immovable_assets_cr  = self._extract_amount(text_lower, "immovable_assets")
        result.self_income_cr       = self._extract_amount(text_lower, "self_income")
        result.spouse_income_cr     = self._extract_amount(text_lower, "spouse_income")
        result.criminal_cases       = self._extract_criminal_cases(text_lower)

        # Name and party from text (lower confidence)
        result.politician_name = self._extract_text_field(text, "name")
        result.party           = self._extract_text_field(text, "party")

        # Compute confidence score
        key_fields = [
            result.total_assets_cr,
            result.self_income_cr,
        ]
        found = sum(1 for f in key_fields if f > 0)
        result.parse_confidence = found / len(key_fields)

        log.info(f"Parsed {pdf_path.name} — "
                 f"Assets: ₹{result.total_assets_cr}Cr | "
                 f"Confidence: {result.parse_confidence:.0%}")
        return result

    def _extract_text(self, pdf_path: Path) -> str:
        """Extract all text from PDF using pdfplumber."""
        all_text = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    all_text.append(text)
        return "\n".join(all_text)

    def _extract_amount(self, text: str, field: str) -> float:
        """
        Try each regex pattern for a field.
        Returns the first match converted to crore.
        """
        for pattern in self.PATTERNS.get(field, []):
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                raw = match.group(1).replace(",", "").strip()
                try:
                    value = float(raw)
                    return self._normalise_to_crore(value, text, match.start())
                except ValueError:
                    continue
        return 0.0

    def _normalise_to_crore(self, value: float, text: str,
                             pos: int) -> float:
        """
        ECI affidavits use rupees (not crore) in most sections.
        Detect the unit from surrounding context and convert.
        """
        # Look at 40 chars around the match for unit hints
        context = text[max(0, pos-20):pos+60].lower()

        if "crore" in context or "cr." in context:
            return round(value, 4)
        if "lakh" in context or "lac" in context:
            return round(value / 100, 4)
        # Default assumption: value is in rupees (most affidavits)
        if value > 1_00_00_000:         # > 1 crore in rupees
            return round(value / 1_00_00_000, 4)
        if value > 1_00_000:            # > 1 lakh
            return round(value / 1_00_00_000, 4)
        return round(value, 4)

    def _extract_text_field(self, text: str, field: str) -> str:
        """Extract a text (non-numeric) field."""
        for pattern in self.PATTERNS.get(field, []):
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).strip().title()
        return ""

    def _extract_criminal_cases(self, text: str) -> list[dict]:
        """
        Find the criminal antecedents section and extract case entries.
        Returns a list of dicts matching the scoring engine's expected shape.
        """
        cases = []

        # Locate the criminal section
        section_start = -1
        for marker in self.CRIMINAL_SECTION_MARKERS:
            idx = text.find(marker)
            if idx != -1:
                section_start = idx
                break

        if section_start == -1:
            return cases  # No criminal section found

        # Extract up to 3000 chars of the criminal section
        section_text = text[section_start:section_start + 3000]

        # Pattern: IPC section numbers, case numbers, court names
        case_pattern = re.compile(
            r"(?:case\s+(?:no\.?|number)\s*:?\s*)([\w/\-]+)"
            r"|(?:u/s|under\s+section)\s+([\d\s,/]+(?:ipc|crpc|poca|pmla)?)"
            r"|(?:fir\s+no\.?\s*:?\s*)([\w/\-]+)",
            re.IGNORECASE
        )

        # Status detection
        status_map = {
            "convicted":   "CONVICTED",
            "acquitted":   "ACQUITTED",
            "discharged":  "ACQUITTED",
            "dropped":     "DROPPED",
            "compounded":  "DROPPED",
            "pending":     "PENDING",
            "under trial": "PENDING",
        }

        for match in case_pattern.finditer(section_text):
            case_text = match.group(0)
            # Look ahead 200 chars for status
            ahead = section_text[match.start():match.start()+200].lower()
            status = "PENDING"
            for keyword, mapped_status in status_map.items():
                if keyword in ahead:
                    status = mapped_status
                    break

            cases.append({
                "case":        case_text.strip(),
                "status":      status,
                "resolvedYear": None,   # enriched separately
                "note":        "",
            })

        log.info(f"Found {len(cases)} criminal case(s)")
        return cases


# ─── MULTI-YEAR AGGREGATOR ───────────────────────────────────────────────────

class PoliticianAggregator:
    """
    Combines affidavit data across multiple election years for one politician
    to build the totalAssets time series the scoring engine needs.

    e.g. { 2009: 1.8, 2014: 4.2, 2019: 18.7, 2024: 64.3 }
    """

    def aggregate(self, parsed_years: dict[int, ParsedAffidavit]) -> dict:
        """
        parsed_years: { 2009: ParsedAffidavit, 2014: ParsedAffidavit, ... }
        Returns a dict in the scoring engine format.
        """
        total_assets    = {}
        liabilities     = {}
        declared_income = {}

        for year, affidavit in sorted(parsed_years.items()):
            total_assets[year]    = affidavit.total_assets_cr
            liabilities[year]     = affidavit.total_liabilities_cr
            # Income is declared per year — use self + spouse
            declared_income[year] = round(
                affidavit.self_income_cr + affidavit.spouse_income_cr, 4
            )

        # Use the most recent affidavit for identity fields
        latest = parsed_years[max(parsed_years.keys())]

        return {
            "name":            latest.politician_name,
            "party":           latest.party,
            "constituency":    latest.constituency,
            "state":           latest.state,

            # Scoring engine inputs
            "totalAssets":     total_assets,
            "liabilities":     liabilities,
            "declaredIncome":  declared_income,
            "holdings":        latest.holdings,       # enriched separately
            "tradeEvents":     latest.trade_events,   # enriched separately
            "criminalCases":   latest.criminal_cases,
            "partyHistory":    [],                    # enriched separately
            "network":         latest.network,        # enriched separately
            "disclosure":      latest.disclosure,

            # Meta
            "parseConfidence": latest.parse_confidence,
            "pdfUrl":          latest.pdf_url,
        }


# ─── PIPELINE ────────────────────────────────────────────────────────────────

class NetaWatchPipeline:
    """
    Full end-to-end pipeline:
      1. Search MyNeta for the politician
      2. Download affidavit PDFs for each available election year
      3. Parse each PDF
      4. Aggregate into a single scoring-engine-ready JSON
      5. Save to data/parsed/{name}.json
    """

    ELECTION_YEARS = [2009, 2014, 2019, 2024]

    def __init__(self):
        self.scraper     = ECIScraper()
        self.parser      = AffidavitParser()
        self.aggregator  = PoliticianAggregator()

    def run(self, name: str, state: str = "") -> Optional[dict]:
        log.info(f"━━━ Starting pipeline for: {name} ━━━")

        parsed_years = {}

        for year in self.ELECTION_YEARS:
            log.info(f"── Year: {year}")

            # 1. Search
            candidates = self.scraper.search_politician(name, state, year)
            if not candidates:
                log.info(f"No results for {name} in {year} — skipping")
                continue

            # Pick the best match (first result — can add fuzzy matching later)
            candidate = candidates[0]
            log.info(f"Using: {candidate['name']} | {candidate['party']} | "
                     f"{candidate['constituency']}")

            # 2. Get PDF URL
            pdf_url = self.scraper.get_affidavit_pdf_url(
                candidate["affidavit_url"]
            )
            if not pdf_url:
                log.warning(f"No PDF found for {year} — skipping")
                continue

            # 3. Download
            filename = f"{name.replace(' ','_')}_{year}.pdf"
            pdf_path = self.scraper.download_pdf(pdf_url, filename)
            if not pdf_path:
                log.warning(f"Download failed for {year} — skipping")
                continue

            # 4. Parse
            affidavit = self.parser.parse(pdf_path)
            affidavit.party        = candidate["party"]
            affidavit.constituency = candidate["constituency"]
            parsed_years[year]     = affidavit

        if not parsed_years:
            log.error(f"No data found for {name}")
            return None

        # 5. Aggregate
        result = self.aggregator.aggregate(parsed_years)

        # 6. Save
        output_path = OUTPUT_DIR / f"{name.replace(' ', '_')}.json"
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)
        log.info(f"━━━ Saved to {output_path} ━━━")

        return result

    def run_batch(self, csv_path: str) -> list[dict]:
        """
        Run the pipeline for multiple politicians from a CSV file.

        CSV format:
            name,state
            Arvind Kejriwal,Delhi
            Rahul Gandhi,Kerala
        """
        import csv
        results = []
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    result = self.run(row["name"], row.get("state", ""))
                    if result:
                        results.append(result)
                except Exception as e:
                    log.error(f"Pipeline failed for {row['name']}: {e}")
                time.sleep(RATE_LIMIT_SEC)
        return results


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="NetaWatch — ECI Affidavit Scraper & Parser"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--name",  type=str, help="Politician full name")
    group.add_argument("--batch", type=str, help="Path to CSV file for batch processing")

    parser.add_argument("--state", type=str, default="",
                        help="State name (helps narrow search results)")
    parser.add_argument("--year",  type=int, default=2024,
                        help="Election year (default: 2024)")

    args = parser.parse_args()
    pipeline = NetaWatchPipeline()

    if args.name:
        result = pipeline.run(args.name, args.state)
        if result:
            print("\n── OUTPUT ──")
            print(json.dumps(result, indent=2))
    else:
        results = pipeline.run_batch(args.batch)
        print(f"\nProcessed {len(results)} politicians")
        summary_path = OUTPUT_DIR / "batch_summary.json"
        with open(summary_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Saved to {summary_path}")


if __name__ == "__main__":
    main()


# ─── NOTES FOR CALIBRATION STEP ──────────────────────────────────────────────
"""
AFTER running the scraper on 10–15 real politicians:

1. Open data/parsed/*.json and manually review each one
2. Add a "knownRiskLevel" field based on your research:
   e.g. "knownRiskLevel": "HIGH"
3. Pass the array to calibrateWeights() in scoring-engine.js:

   import { calibrateWeights } from "./scoring-engine.js"
   const result = calibrateWeights(labelledData)
   console.log(result.accuracy)           // e.g. "78.5%"
   console.log(result.suggestedWeights)   // new weights to plug back in

4. Update WEIGHTS in scoring-engine.js with the suggested values
5. Re-run — accuracy should improve

KNOWN LIMITATIONS OF THIS PARSER:
- Scanned PDFs (common pre-2014) require OCR — use Tesseract or Google Vision
- Hindi/regional language affidavits need translation layer
- Some PDFs have inconsistent section headers — confidence score will be low
- Income figures sometimes include spouse income in same line — needs validation

ENRICHMENT NEEDED (not in affidavit, needs other sources):
- holdings[]     → scrape Lok Sabha/Rajya Sabha disclosure registers
- tradeEvents[]  → cross-reference with NSE/BSE bulk deal data
- partyHistory[] → scrape Wikipedia / Election Commission candidate history
- network[]      → MCA21 director data + media cross-referencing
"""
