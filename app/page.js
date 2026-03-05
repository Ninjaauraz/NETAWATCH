// app/page.js — Server Component
import { SEED_POLITICIANS } from "@/lib/seed";
import { scoreBatch } from "@/lib/scoring";
import NetaWatchClient from "@/components/NetaWatchClient";

export const revalidate = 3600; // revalidate every hour

export default function Home() {
  // Score all politicians server-side (fast, no API round-trip)
  const politicians = scoreBatch(SEED_POLITICIANS);
  return <NetaWatchClient initialData={politicians} />;
}
