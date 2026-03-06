"use client";
import { useState, useEffect } from "react";
import NetaWatchClient, { scoreBatch } from "../components/NetaWatchClient";
import { SEED_POLITICIANS } from "../lib/seed";

export default function Home() {
  const [pols] = useState(() => scoreBatch(SEED_POLITICIANS));
  return <NetaWatchClient initialData={pols}/>;
}
