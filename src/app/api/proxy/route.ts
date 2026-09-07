import { NextResponse } from "next/server";
import { sha256Bytes } from "@/lib/canonical";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function imageFromHtml(html: string, base: URL): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return new URL(match[1].replace(/&amp;/g, "&"), base).toString();
    } catch {}
  }
  return null;
}

/**
 * Some sites (Instagram among them) only emit og:/twitter: meta tags for
 * crawlers, so the page refetch below asks as one.
 */
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * og:image URLs arrive HTML-escaped. Signed CDN links carry their signature in
 * the query string, so leaving &amp; in place breaks the signature and the
 * fetch 403s. Only the five predefined XML entities can appear in an attribute.
 */
const decodeEntities = (s: string) =>
  s
    .replace(/&(?:amp|#38|#x26);/gi, "&")
    .replace(/&(?:lt|#60|#x3c);/gi, "<")
    .replace(/&(?:gt|#62|#x3e);/gi, ">")
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'");

/**
 * Fetches a candidate image server-side and hands back both the bytes (as a
 * data URL, so the canvas stays untainted and the browser can re-encode the
 * face) and their sha256. Hashing here rather than in the browser keeps the
 * digest that goes into the evidence bundle authoritative.
 */
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Pass the image address as ?url=" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "That is not a valid URL." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Only http and https addresses are fetched." }, { status: 400 });
  }

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

  /**
   * Two attempts. Plain first; then again sending the image's own origin as
   * Referer, which is what hotlink-protected CDNs check. Sending a Referer
   * unconditionally makes some hosts stricter, so it is the fallback rather
   * than the default.
   */
  const attempt = (referer: string | null, ua: string = UA) =>
    fetch(parsed.toString(), {
      headers: {
        // Some CDNs refuse requests without a browser-shaped UA.
        "User-Agent": ua,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

  const isImage = (r: Response) =>
    (r.headers.get("content-type") || "").startsWith("image/");

  try {
    let res = await attempt(null);
    if (!res.ok) {
      res = await attempt(parsed.origin + "/");
    }

    /**
     * Meta's lookaside hosts serve the real bytes to a crawler and a tiny HTML
     * stub to a browser — same URL, same 200. Retrying once as a crawler is
     * cheaper than parsing the stub, and it costs a request only when the
     * browser-shaped attempt already failed to produce an image.
     */
    if (res.ok && !isImage(res)) {
      const asCrawler = await attempt(null, CRAWLER_UA).catch(() => null);
      if (asCrawler?.ok && isImage(asCrawler)) {
        res = asCrawler;
      }
    }

    /**
     * Some "image" URLs are really page URLs. Instagram's Lens/SERP results
     * come back as lookaside.instagram.com/seo/google_widget/crawler/?media_id=…,
     * which 302s to the post's HTML for every UA we can send. The image the
     * page is about is still declared in its og:image meta tag, so when a
     * fetch lands on HTML we read that tag and fetch the picture it names.
     * Host-agnostic: any oEmbed-ish page URL recovers the same way. One hop
     * only, so a page whose og:image is itself HTML fails instead of looping.
     */
    if (res.ok && !(res.headers.get("content-type") || "").startsWith("image/")) {
      /**
       * Refetch the page as a crawler. Instagram only renders og/twitter meta
       * tags for crawler user agents — a browser UA gets a script shell with no
       * meta tags at all — so the browser-shaped UA above cannot see the image.
       */
      const page = await fetch(res.url, {
        headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      let html = ((await page?.text()) ?? "").slice(0, 400_000);
      let pageUrl = page?.url || res.url;

      /**
       * Some endpoints bounce via a script rather than a 3xx, so redirect:
       * "follow" never sees it and we land on a stub with no meta tags at all.
       * Follow one such hop by hand; one is enough to reach the real page and
       * keeps a pair of stubs from bouncing us in circles.
       */
      const jsHop = html.match(
        /(?:location\.(?:href|replace)\s*(?:=|\()\s*|<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=)["']?([^"'()\s>]+)/i,
      );
      if (jsHop && !/og:image|twitter:image/i.test(html)) {
        try {
          // JS string literals escape their slashes ("https:\/\/..."), so undo that.
          const hop = new URL(jsHop[1].split("\\/").join("/"), pageUrl);
          if (hop.protocol === "https:" || hop.protocol === "http:") {
            const hopped = await fetch(hop.toString(), {
              headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,*/*" },
              redirect: "follow",
              signal: AbortSignal.timeout(20_000),
            }).catch(() => null);
            if (hopped?.ok) {
              html = (await hopped.text()).slice(0, 400_000);
              pageUrl = hopped.url;
            }
          }
        } catch {
          /* unparseable hop target, fall through to the og:image attempt */
        }
      }

      const og = html.match(
        /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/i,
      );
      // res is consumed now, so every path below must replace it or bail out.
      let found: URL | null = null;
      if (og) {
        try {
          const u = new URL(decodeEntities(og[1]), pageUrl);
          if (u.protocol === "https:" || u.protocol === "http:") found = u;
        } catch {
          /* unparseable og:image, treated as absent */
        }
      }
      if (!found) {
        return NextResponse.json(
          { error: "Source served a page, not an image." },
          { status: 415 },
        );
      }
      res = await fetch(found.toString(), {
        headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Source returned ${res.status} for that image.` },
        { status: 502 },
      );
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "Source returned an empty image." }, { status: 502 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image exceeds the 8 MB fetch limit." }, { status: 413 });
    }

    let mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!mime.startsWith("image/")) {
      // Instagram/Facebook crawler endpoints often return a shell without
      // metadata to an image-oriented request. Retry as a page before giving
      // up, then resolve its og:image/twitter:image URL.
      const htmlResponse = await fetch(parsed.toString(), {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          Referer: `${parsed.origin}/`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (htmlResponse.ok) {
        const htmlMime = htmlResponse.headers.get("content-type")?.split(";")[0] || "";
        if (!htmlMime.startsWith("image/")) {
          const html = await htmlResponse.text();
          const imageUrl = imageFromHtml(html, parsed);
          if (imageUrl) {
            const imageResponse = await fetch(imageUrl, {
              headers: {
                "User-Agent": UA,
                Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                Referer: `${parsed.origin}/`,
              },
              redirect: "follow",
              signal: AbortSignal.timeout(20_000),
            });
            const imageMime = imageResponse.headers.get("content-type")?.split(";")[0] || "";
            if (imageResponse.ok && imageMime.startsWith("image/")) {
              const imageBuf = new Uint8Array(await imageResponse.arrayBuffer());
              if (imageBuf.byteLength > 0 && imageBuf.byteLength <= MAX_BYTES) {
                return NextResponse.json({
                  sha256: sha256Bytes(imageBuf),
                  mime: imageMime,
                  bytes: imageBuf.byteLength,
                  dataUrl: `data:${imageMime};base64,${Buffer.from(imageBuf).toString("base64")}`,
                });
              }
            }
          }
        }
      }
      if (buf.byteLength > MAX_HTML_BYTES) {
        return NextResponse.json({ error: `Source served ${mime}, not an image.` }, { status: 415 });
      }
      const imageUrl = imageFromHtml(new TextDecoder().decode(buf), parsed);
      if (!imageUrl) {
        return NextResponse.json({ error: `Source served ${mime}, not an image.` }, { status: 415 });
      }
      const imageResponse = await fetch(imageUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: `${parsed.origin}/`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!imageResponse.ok) {
        return NextResponse.json({ error: `Preview image returned ${imageResponse.status}.` }, { status: 502 });
      }
      const imageMime = imageResponse.headers.get("content-type")?.split(";")[0] || "";
      if (!imageMime.startsWith("image/")) {
        return NextResponse.json({ error: "Preview source did not return an image." }, { status: 415 });
      }
      const imageBuf = new Uint8Array(await imageResponse.arrayBuffer());
      if (imageBuf.byteLength === 0 || imageBuf.byteLength > MAX_BYTES) {
        return NextResponse.json({ error: "Preview image is empty or exceeds the 8 MB limit." }, { status: 502 });
      }
      mime = imageMime;
      return NextResponse.json({
        sha256: sha256Bytes(imageBuf),
        mime,
        bytes: imageBuf.byteLength,
        dataUrl: `data:${mime};base64,${Buffer.from(imageBuf).toString("base64")}`,
      });
    }

    return NextResponse.json({
      sha256: sha256Bytes(buf),
      mime,
      bytes: buf.byteLength,
      dataUrl: `data:${mime};base64,${Buffer.from(buf).toString("base64")}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not fetch that image.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
