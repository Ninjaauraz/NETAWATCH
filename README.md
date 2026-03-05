# NetaWatch — Deployment Guide

## What you have
A fully working Next.js app that:
- Works immediately with demo data (no Supabase needed)
- Connects to Supabase when you add env vars
- Deploys to Vercel in under 5 minutes

---

## Step 1 — Upload to GitHub (5 min)

1. Go to https://github.com → Sign in → New repository
2. Name it `netawatch` → Create repository
3. Upload all these files (drag & drop on GitHub, or use git):

```
netawatch/
├── app/
│   ├── layout.js
│   ├── page.js
│   └── api/
│       └── politicians/
│           ├── route.js
│           └── [id]/route.js
├── components/
│   └── NetaWatchClient.js
├── lib/
│   ├── scoring.js
│   ├── seed.js
│   └── supabase.js
├── package.json
├── next.config.js
└── .env.example
```

---

## Step 2 — Set up Supabase (optional but recommended, 5 min)

1. Go to https://supabase.com → New project → free tier
2. Once created: Dashboard → SQL Editor → New Query
3. Paste the contents of `supabase-schema.sql` → Run
4. Go to Settings → API → copy:
   - Project URL
   - anon / public key

---

## Step 3 — Deploy to Vercel (3 min)

1. Go to https://vercel.com → Sign in with GitHub
2. Click "Add New Project" → Import your `netawatch` repo
3. Under "Environment Variables" add:
   ```
   NEXT_PUBLIC_SUPABASE_URL     = https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJxxxxxxx
   ```
   (Skip this step if not using Supabase — app works without it)
4. Click Deploy

✅ Your site will be live at `https://netawatch.vercel.app`
   (or whatever Vercel assigns — you can set a custom domain later)

---

## Adding real politician data

### Option A — Manual (easiest to start)
Edit `lib/seed.js` and add politicians in the same format.

### Option B — Via Supabase dashboard
Insert rows directly in the Supabase Table Editor.

### Option C — Via scraper
```bash
cd scraper/
pip install requests beautifulsoup4 pdfplumber
python scraper.py --name "Rahul Gandhi" --state "Kerala"
```
Then copy the output JSON into Supabase.

---

## Custom domain (optional)

1. Buy a domain at Namecheap / GoDaddy (~₹800/yr for .in)
   Suggested: `netawatch.in`
2. Vercel → Your project → Settings → Domains → Add domain
3. Follow DNS instructions (takes ~10 min to propagate)

---

## Tech stack summary

| Layer      | Tool              | Cost       |
|------------|-------------------|------------|
| Frontend   | Next.js on Vercel | Free       |
| Database   | Supabase          | Free tier  |
| Scraper    | Python (local)    | Free       |
| Domain     | .in domain        | ~₹800/yr   |

**Total monthly cost to run: ₹0**
