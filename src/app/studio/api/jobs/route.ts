import { NextResponse } from "next/server";
import { pollJob } from "@/lib/studio/assets/jobs";
import { studioApiContext } from "@/lib/studio/auth";

// The Assets page calls this every few seconds while images are generating.
// Each call checks each job once with KIE and stores any finished image. Short by design.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const c = await studioApiContext();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 12) : [];
  const jobs: { id: string; status: string }[] = [];
  for (const id of ids) jobs.push({ id, status: await pollJob(c.supabase, id) });
  return NextResponse.json({ jobs });
}
