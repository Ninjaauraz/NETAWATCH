// app/api/politicians/[id]/route.js
import { supabase } from "@/lib/supabase";
import { SEED_POLITICIANS } from "@/lib/seed";
import { scorePolitician } from "@/lib/scoring";

export async function GET(request, { params }) {
  const { id } = params;
  let politician = null;

  if (supabase) {
    const { data, error } = await supabase
      .from("politicians")
      .select("*")
      .eq("id", id)
      .single();
    if (!error && data) politician = data;
  }

  if (!politician) {
    politician = SEED_POLITICIANS.find(p => p.id === id);
  }

  if (!politician) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ...politician, scoring: scorePolitician(politician) });
}
