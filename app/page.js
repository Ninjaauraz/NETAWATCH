"use client";
import NetaWatchClient from "../components/NetaWatchClient";
import { SEED_POLITICIANS } from "../lib/seed";
import { scoreBatch } from "../lib/scoring";

export default function Home() {
  const politicians = scoreBatch(SEED_POLITICIANS);
  return <NetaWatchClient initialData={politicians} />;
}
