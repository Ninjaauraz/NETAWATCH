"use client";
import { useState, useEffect } from "react";
import NetaWatchClient, { scoreBatch } from "../components/NetaWatchClient";
import { SEED_POLITICIANS } from "../lib/seed";

export default function Home() {
  // Start with scored seed data so the page renders immediately
  const [politicians] = useState(() => scoreBatch(SEED_POLITICIANS));

  // The SSE stream at /api/stream sends a full "init" event with live-scored data,
  // so NetaWatchClient handles its own live updates internally.
  // This page just needs to provide the initial render-blocking fallback.
  return <NetaWatchClient initialData={politicians} />;
}
