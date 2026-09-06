import { NextRequest, NextResponse } from "next/server";
import { crawlConnectedIdentities, parseLinksFromHtml, extractBioHubUrl } from "@/lib/page-crawler";

export const runtime = "nodejs";

/**
 * POST /api/intel
 *
 * Crawls a target URL to discover outbound social accounts and follows 1-hop
 * into bio hubs (Linktree, Beacons, Carrd, Bento).
 *
 * Body: { url: string, html?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, html } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "A valid target 'url' is required." },
        { status: 400 }
      );
    }

    // Direct HTML parse mode (ideal for unit testing or when client already holds page HTML)
    if (html && typeof html === "string") {
      const start = Date.now();
      const hubFound = extractBioHubUrl(html);
      const profiles = parseLinksFromHtml(html, "page");

      return NextResponse.json({
        targetUrl: url,
        hubFound,
        profiles,
        scannedAt: new Date().toISOString(),
        elapsedMs: Date.now() - start,
      });
    }

    // Full remote crawl mode
    const report = await crawlConnectedIdentities(url);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intelligence crawl failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
