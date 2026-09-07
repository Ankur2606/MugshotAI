import { NextRequest, NextResponse } from "next/server";
import {
  crawlConnectedIdentities,
  crawlMultiCategoryIdentities,
  parseLinksFromHtml,
  extractBioHubUrl,
  extractAuthorFromUrl,
  type TargetSpecimen,
} from "@/lib/page-crawler";

export const runtime = "nodejs";

/**
 * POST /api/intel
 *
 * Discovers post authors, extracts commenters and tagged profiles,
 * and recursively follows 1-hop into bio hubs (Linktree, Beacons, Carrd).
 *
 * Body can be either:
 * - Single target: { url: string, category?: string, label?: string, html?: string }
 * - Multi-target:  { targets: TargetSpecimen[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Multi-target crawl across detected persons & categories
    if (Array.isArray(body.targets) && body.targets.length > 0) {
      const targets: TargetSpecimen[] = body.targets.filter(
        (t: TargetSpecimen) => t && typeof t.url === "string" && t.url.trim().length > 0
      );
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "No valid target URLs provided in 'targets'." },
          { status: 400 }
        );
      }

      const reports = await crawlMultiCategoryIdentities(targets.slice(0, 6)); // Cap at 6 targets for high speed
      return NextResponse.json({
        multi: true,
        reports,
        totalDiscovered: reports.reduce((acc, r) => acc + r.profiles.length, 0),
      });
    }

    const { url, html, category, label, title } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "A valid target 'url' is required." },
        { status: 400 }
      );
    }

    // Direct HTML parse mode (ideal for unit tests or when client holds HTML)
    if (html && typeof html === "string") {
      const start = Date.now();
      const directAuthor = extractAuthorFromUrl(url);
      const hubFound = extractBioHubUrl(html);
      const profiles = parseLinksFromHtml(html, "page", undefined, true, directAuthor?.handle);

      const all = directAuthor
        ? [directAuthor, ...profiles.filter((p) => p.url !== directAuthor.url)]
        : profiles;

      return NextResponse.json({
        targetUrl: url,
        hubFound,
        profiles: all.map((p) => ({ ...p, category, categoryLabel: label })),
        scannedAt: new Date().toISOString(),
        elapsedMs: Date.now() - start,
      });
    }

    // Full remote crawl mode
    const report = await crawlConnectedIdentities(url, category, label, title);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Footprint crawl failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
