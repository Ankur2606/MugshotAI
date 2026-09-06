import { NextResponse } from "next/server";
import { runSherlock } from "@/lib/sherlock-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/sherlock
 * Body: { username: string }
 *
 * Runs the real Sherlock CLI (sherlock-project) for a given username
 * and returns found platform profile URLs.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = (body?.username ?? "").trim().replace(/^@/, "");

  if (!username || username.length < 2 || username.length > 50) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_.\-]{2,50}$/.test(username)) {
    return NextResponse.json({ error: "Username contains invalid characters" }, { status: 400 });
  }

  try {
    const results = await runSherlock(username);
    return NextResponse.json({ username, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sherlock failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
