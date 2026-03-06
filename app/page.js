"use client";
import { useState, useEffect } from "react";
import NetaWatchClient, { scoreBatch } from "../components/NetaWatchClient";
import { SEED_POLITICIANS } from "../lib/seed";

export default function Home() {
  const [politicians, setPoliticians] = useState(() => scoreBatch(SEED_POLITICIANS));

  useEffect(() => {
    fetch("/politicians.json")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.length > 0) setPoliticians(scoreBatch(data)); })
      .catch(() => {});
  }, []);

  return <NetaWatchClient initialData={politicians} />;
}
