/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

//#region console
const DevMode = true;
const originalConsoleLog = console.log;
console.log = function (...args) {
    if (DevMode) originalConsoleLog.apply(console, args);
};
//#endregion

const BASE_URL = "https://voir-anime.to";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;

function getSettings() {
    return {
        servers: [
            { value: "myTV",   label: "LECTEUR myTV"   },
            { value: "MOON",   label: "LECTEUR MOON"   },
            { value: "SB",     label: "LECTEUR SB"     },
            { value: "VOE",    label: "LECTEUR VOE"    },
            { value: "Stape",  label: "LECTEUR Stape"  },
            { value: "FHD1",   label: "LECTEUR FHD1"   },
            { value: "YU",     label: "LECTEUR YU"     },
        ],
        episodeServers: ["myTV", "MOON", "SB", "VOE", "Stape", "FHD1", "YU"],
    };
}

// ─── SEARCH ────────────────────────────────────────────────────────────────────
async function search(opts) {
    const query = encodeURIComponent(opts.query);
    const url = `${BASE_URL}/?s=${query}&post_type=wp-manga`;
    console.log("[search] URL:", url);

    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    });
    const html = await res.text();
    const results = [];

    // Each result block: <div class="page-item-detail video">
    // Contains data-post-id on the thumb div, and .post-title h3 a for url/title
    const blockRegex = /<div[^>]+class="[^"]*page-item-detail[^"]*video[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let block;

    while ((block = blockRegex.exec(html)) !== null) {
        const content = block[0];

        // Extract post-id from data-post-id attribute
        const postIdMatch = content.match(/data-post-id="(\d+)"/);
        const postId = postIdMatch ? postIdMatch[1] : null;

        // Extract href and title from .post-title h3 a
        const linkMatch = content.match(/<div[^>]+class="[^"]*post-title[^"]*"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/);
        if (!linkMatch) continue;

        const href = linkMatch[1].trim();
        const title = linkMatch[2].trim()
            .replace(/&#8217;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&#[0-9]+;/g, "");

        const slugMatch = href.match(/\/anime\/([^/]+)\/?$/);
        const slug = slugMatch ? slugMatch[1] : href;

        const isVF = title.includes("(VF)") || title.toLowerCase().includes("(vf)") ||
                     slug.endsWith("-vf") || content.includes("manga-vf-flag");

        results.push({
            id: postId ? `${slug}|||${postId}` : slug,
            title: title,
            url: href,
            subOrDub: isVF ? "dub" : "sub",
        });
    }

    console.log("[search] Found:", results.length, "results");
    return results;
}

// ─── FIND EPISODES ─────────────────────────────────────────────────────────────
async function findEpisodes(id) {
    // id format: "slug|||postId"  OR just "slug"
    let slug = id;
    let mangaId = null;

    if (id.includes("|||")) {
        [slug, mangaId] = id.split("|||");
    }

    const animeUrl = `${BASE_URL}/anime/${slug}/`;
    console.log("[findEpisodes] Fetching:", animeUrl);

    const res = await fetch(animeUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    });
    const html = await res.text();

    // Extract manga_id from JS if not already known
    if (!mangaId) {
        const m = html.match(/"manga_id"\s*:\s*"?(\d+)"?/);
        if (m) mangaId = m[1];
    }

    let episodeListHtml = html;

    // Try AJAX for full episode list (useful for long series)
    if (mangaId) {
        try {
            const ajaxRes = await fetch(AJAX_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": animeUrl,
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: `action=manga_get_chapters&manga=${mangaId}`,
            });
            const ajaxHtml = await ajaxRes.text();
            if (ajaxHtml && ajaxHtml.length > 100) {
                episodeListHtml = ajaxHtml;
                console.log("[findEpisodes] Using AJAX episode list, length:", ajaxHtml.length);
            }
        } catch (e) {
            console.log("[findEpisodes] AJAX failed:", e.message);
        }
    }

    const episodes = [];
    // Pattern: <li class="wp-manga-chapter ..."><a href="URL">Title</a>
    const epRegex = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;

    while ((m = epRegex.exec(episodeListHtml)) !== null) {
        const epUrl = m[1].trim();
        const epTitle = m[2].replace(/<[^>]+>/g, "").trim();

        // Extract episode slug from URL: .../anime/slug/episode-slug/
        const urlParts = epUrl.replace(/\/$/, "").split("/");
        const epSlug = urlParts[urlParts.length - 1];

        // Extract number — handle "naruto-065-vostfr", "214x215", "095x096", etc.
        // Try last number sequence in slug
        const numMatch = epTitle.match(/[\s-](\d+(?:[x×]\d+)?)\s*(?:VOSTFR|VF|$)/i) ||
                         epTitle.match(/(\d+(?:\.\d+)?)[\s]*$/);
        let epNum = episodes.length + 1;
        if (numMatch) {
            const raw = numMatch[1].replace(/[x×].*/i, "");
            epNum = parseFloat(raw) || epNum;
        }

        episodes.push({
            id: epSlug,
            number: epNum,
            title: epTitle,
            url: epUrl,
        });
    }

    // Sort ascending by episode number
    episodes.sort((a, b) => a.number - b.number);

    console.log("[findEpisodes] Total episodes:", episodes.length);
    return episodes;
}

// ─── FIND EPISODE SERVER ───────────────────────────────────────────────────────
async function findEpisodeServer(episode, server) {
    const epUrl = episode.url;
    console.log("[findEpisodeServer] URL:", epUrl, "| server:", server);

    const res = await fetch(epUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Referer": BASE_URL,
        },
    });
    const html = await res.text();

    // ── Parse thisChapterSources ──────────────────────────────────────────────
    // var thisChapterSources = {"LECTEUR myTV":"<iframe src=\"...\">", ...};
    const sourcesMatch = html.match(/var\s+thisChapterSources\s*=\s*(\{[\s\S]*?\});\s/);
    if (!sourcesMatch) {
        console.log("[findEpisodeServer] thisChapterSources not found");
        return { headers: {}, subtitles: [], sources: [] };
    }

    // Parse key/value pairs from the raw JS object string
    const raw = sourcesMatch[1];
    const sources = {};
    const kvRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let kv;
    while ((kv = kvRegex.exec(raw)) !== null) {
        const key = kv[1];
        // Decode JSON escape sequences in the iframe HTML
        const val = kv[2]
            .replace(/\\\//g, "/")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        sources[key] = val;
    }

    console.log("[findEpisodeServer] Available sources:", Object.keys(sources));

    // ── Find matching server ──────────────────────────────────────────────────
    let iframeHtml = null;
    const serverLower = server.toLowerCase();

    for (const key of Object.keys(sources)) {
        if (key.toLowerCase().includes(serverLower)) {
            iframeHtml = sources[key];
            console.log("[findEpisodeServer] Matched key:", key);
            break;
        }
    }

    // Fallback: first available source
    if (!iframeHtml) {
        const firstKey = Object.keys(sources)[0];
        if (firstKey) {
            iframeHtml = sources[firstKey];
            console.log("[findEpisodeServer] Fallback to:", firstKey);
        }
    }

    if (!iframeHtml) {
        console.log("[findEpisodeServer] No source found");
        return { headers: {}, subtitles: [], sources: [] };
    }

    // ── Extract iframe src ────────────────────────────────────────────────────
    const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
    if (!srcMatch) {
        console.log("[findEpisodeServer] No src in iframe:", iframeHtml.substring(0, 200));
        return { headers: {}, subtitles: [], sources: [] };
    }

    const embedUrl = srcMatch[1];
    console.log("[findEpisodeServer] Embed URL:", embedUrl);

    // ── Resolve embed to direct video ─────────────────────────────────────────
    const videoSources = await resolveEmbed(embedUrl, epUrl);
    return {
        headers: { "Referer": epUrl },
        subtitles: [],
        sources: videoSources,
    };
}

// ─── RESOLVE EMBED ─────────────────────────────────────────────────────────────
async function resolveEmbed(embedUrl, referer) {
    console.log("[resolveEmbed] URL:", embedUrl);
    try {
        const res = await fetch(embedUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": referer || BASE_URL,
                "Accept": "text/html,*/*;q=0.8",
            },
        });
        const html = await res.text();

        // m3u8 first
        const m3u8Match = html.match(/(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/);
        if (m3u8Match) {
            console.log("[resolveEmbed] Found m3u8:", m3u8Match[1]);
            return [{ url: m3u8Match[1], type: "m3u8", quality: "auto" }];
        }

        // mp4
        const mp4Match = html.match(/(https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*)/);
        if (mp4Match) {
            console.log("[resolveEmbed] Found mp4:", mp4Match[1]);
            return [{ url: mp4Match[1], type: "mp4", quality: "auto" }];
        }

        // Generic "file"/"src" JS pattern
        const fileMatch = html.match(/["'](file|src)["']\s*:\s*["']([^"']+\.(m3u8|mp4)[^"']*)['"]/);
        if (fileMatch) {
            const videoUrl = fileMatch[2];
            const type = videoUrl.includes(".m3u8") ? "m3u8" : "mp4";
            console.log("[resolveEmbed] Found via pattern:", videoUrl);
            return [{ url: videoUrl, type, quality: "auto" }];
        }

        console.log("[resolveEmbed] No direct video found in embed page");
    } catch (e) {
        console.log("[resolveEmbed] Error:", e.message);
    }
    return [];
}
