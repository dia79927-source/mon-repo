/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

//#region console
const DevMode = true;
const originalConsoleLog = console.log;
console.log = function (...args) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};
//#endregion

//#region Settings
function getSettings() {
    return {
        servers: [
            { value: "myTV", label: "myTV" },
            { value: "MOON", label: "MOON" },
            { value: "Uqload", label: "Uqload" },
            { value: "Sendvid", label: "Sendvid" },
            { value: "Sibnet", label: "Sibnet" },
        ],
        episodeServers: ["myTV", "MOON", "Uqload", "Sendvid", "Sibnet"],
    };
}
//#endregion

//#region Helpers
const BASE_URL = "https://voir-anime.to";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;

function extractBetween(str, start, end) {
    const startIdx = str.indexOf(start);
    if (startIdx === -1) return null;
    const from = startIdx + start.length;
    const endIdx = str.indexOf(end, from);
    if (endIdx === -1) return null;
    return str.substring(from, endIdx);
}

function decodeHtmlEntities(str) {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"');
}
//#endregion

//#region Search
async function search(opts) {
    const query = encodeURIComponent(opts.query);
    const url = `${BASE_URL}/?s=${query}&post_type=wp-manga`;

    console.log("[search] URL:", url);

    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Referer": BASE_URL,
        },
    });

    const html = await res.text();
    const results = [];

    // Parse .page-item-detail blocks
    const itemRegex = /<div[^>]+class="[^"]*page-item-detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let itemMatch;

    // Simpler approach: find all post-title links
    const linkRegex = /<div[^>]+class="[^"]*post-title[^"]*"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1].trim();
        const title = match[2].trim();

        if (!href.includes("/anime/")) continue;

        // Extract slug from URL: /anime/{slug}/
        const slugMatch = href.match(/\/anime\/([^/]+)\/?$/);
        const slug = slugMatch ? slugMatch[1] : href;

        const isVF = title.includes("(VF)") || title.includes("(vf)") || slug.endsWith("-vf");

        results.push({
            id: slug,
            title: title,
            url: href,
            subOrDub: isVF ? "dub" : "sub",
        });
    }

    console.log("[search] Found:", results.length, "results");
    return results;
}
//#endregion

//#region Find Episodes
async function findEpisodes(id) {
    // id is the slug, URL is BASE_URL/anime/{slug}/
    const animeUrl = `${BASE_URL}/anime/${id}/`;
    console.log("[findEpisodes] Fetching:", animeUrl);

    const res = await fetch(animeUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Referer": BASE_URL,
        },
    });

    const html = await res.text();

    // Extract manga_id from JS: var manga = {...,"manga_id":"1277",...}
    let mangaId = null;
    const mangaIdMatch = html.match(/"manga_id"\s*:\s*"?(\d+)"?/);
    if (mangaIdMatch) {
        mangaId = mangaIdMatch[1];
        console.log("[findEpisodes] manga_id:", mangaId);
    }

    let episodeListHtml = html;

    // If manga_id found, use AJAX to get full episode list
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
            episodeListHtml = await ajaxRes.text();
            console.log("[findEpisodes] AJAX response length:", episodeListHtml.length);
        } catch (e) {
            console.log("[findEpisodes] AJAX failed, using page HTML:", e.message);
        }
    }

    // Parse episodes from <li class="wp-manga-chapter">
    const episodes = [];
    const epRegex = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let epMatch;

    while ((epMatch = epRegex.exec(episodeListHtml)) !== null) {
        const epUrl = epMatch[1].trim();
        const epTitle = epMatch[2].trim();

        // Extract episode number
        const numMatch = epTitle.match(/(\d+(?:\.\d+)?)/);
        const epNum = numMatch ? parseFloat(numMatch[1]) : episodes.length + 1;

        // Extract episode slug from URL
        const urlParts = epUrl.replace(/\/$/, "").split("/");
        const epSlug = urlParts[urlParts.length - 1];

        episodes.push({
            id: epSlug,
            number: epNum,
            title: epTitle.replace(/^\s+|\s+$/g, ""),
            url: epUrl,
        });
    }

    // Seanime expects episodes sorted ascending
    episodes.sort((a, b) => a.number - b.number);

    console.log("[findEpisodes] Found:", episodes.length, "episodes");
    return episodes;
}
//#endregion

//#region Find Episode Server
async function findEpisodeServer(episode, server) {
    const epUrl = episode.url;
    console.log("[findEpisodeServer] Fetching:", epUrl, "server:", server);

    const res = await fetch(epUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Referer": BASE_URL,
        },
    });

    const html = await res.text();

    // Extract thisChapterSources from JS
    // var thisChapterSources = {"LECTEUR myTV":"<iframe src=\"...\">","LECTEUR MOON":"<iframe...>",...}
    let sources = {};
    const sourcesMatch = html.match(/var\s+thisChapterSources\s*=\s*(\{[\s\S]*?\});/);
    if (sourcesMatch) {
        try {
            const raw = sourcesMatch[1];
            // The values are HTML-encoded iframe strings
            // Parse key-value pairs manually to avoid JSON issues
            const kvRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
            let kv;
            while ((kv = kvRegex.exec(raw)) !== null) {
                const key = kv[1];
                const val = decodeHtmlEntities(kv[2]);
                sources[key] = val;
            }
            console.log("[findEpisodeServer] Sources keys:", Object.keys(sources));
        } catch (e) {
            console.log("[findEpisodeServer] Parse error:", e.message);
        }
    }

    // Find the right server key
    // Keys look like "LECTEUR myTV", "LECTEUR MOON", etc.
    let iframeHtml = null;
    for (const key of Object.keys(sources)) {
        if (key.toLowerCase().includes(server.toLowerCase())) {
            iframeHtml = sources[key];
            console.log("[findEpisodeServer] Matched server key:", key);
            break;
        }
    }

    // Fallback: take first available
    if (!iframeHtml && Object.keys(sources).length > 0) {
        const firstKey = Object.keys(sources)[0];
        iframeHtml = sources[firstKey];
        console.log("[findEpisodeServer] Fallback to first source:", firstKey);
    }

    if (!iframeHtml) {
        console.log("[findEpisodeServer] No source found");
        return { headers: {}, subtitles: [], sources: [] };
    }

    // Extract iframe src
    const iframeSrcMatch = iframeHtml.match(/src=["']([^"']+)["']/);
    if (!iframeSrcMatch) {
        console.log("[findEpisodeServer] No iframe src found in:", iframeHtml.substring(0, 200));
        return { headers: {}, subtitles: [], sources: [] };
    }

    const embedUrl = iframeSrcMatch[1];
    console.log("[findEpisodeServer] Embed URL:", embedUrl);

    // Try to resolve the embed URL to a direct video source
    const videoSources = await resolveEmbed(embedUrl);
    return {
        headers: { "Referer": epUrl },
        subtitles: [],
        sources: videoSources,
    };
}
//#endregion

//#region Resolve Embed
async function resolveEmbed(embedUrl) {
    console.log("[resolveEmbed] Resolving:", embedUrl);

    try {
        const res = await fetch(embedUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Referer": BASE_URL,
            },
        });
        const html = await res.text();

        // Look for m3u8 URLs
        const m3u8Regex = /(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/g;
        const m3u8Matches = [...html.matchAll(m3u8Regex)];
        if (m3u8Matches.length > 0) {
            console.log("[resolveEmbed] Found m3u8:", m3u8Matches[0][1]);
            return [{ url: m3u8Matches[0][1], type: "m3u8", quality: "auto" }];
        }

        // Look for mp4 URLs
        const mp4Regex = /(https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*)/g;
        const mp4Matches = [...html.matchAll(mp4Regex)];
        if (mp4Matches.length > 0) {
            console.log("[resolveEmbed] Found mp4:", mp4Matches[0][1]);
            return [{ url: mp4Matches[0][1], type: "mp4", quality: "auto" }];
        }

        // Look for file/src patterns in JS
        const fileMatch = html.match(/['"](file|src)['"]\s*:\s*['"]([^'"]+\.(m3u8|mp4)[^'"]*)['"]/);
        if (fileMatch) {
            const videoUrl = fileMatch[2];
            const type = videoUrl.includes(".m3u8") ? "m3u8" : "mp4";
            console.log("[resolveEmbed] Found via JS pattern:", videoUrl);
            return [{ url: videoUrl, type, quality: "auto" }];
        }

        console.log("[resolveEmbed] No video source found in embed page");
    } catch (e) {
        console.log("[resolveEmbed] Error:", e.message);
    }

    return [];
}
//#endregion
