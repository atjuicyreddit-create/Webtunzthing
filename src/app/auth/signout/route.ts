import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/env";

export async function POST(request: Request) {
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  // 303 turns the POST into a normal GET of the home page.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
