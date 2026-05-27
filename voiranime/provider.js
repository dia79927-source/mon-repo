/// <reference path="./online-streaming-provider.d.ts" />

// ============================================================
//  VoirAnime Provider for Seanime
//  Site: https://voir-anime.to  (thème WordPress Madara)
//  Langue : Français (VF & VOSTFR)
// ============================================================

class Provider {
  constructor() {
    this.base = "https://voir-anime.to";
    this.ajaxUrl = "https://voir-anime.to/wp-admin/admin-ajax.php";
  }

  // ----------------------------------------------------------
  //  Paramètres Seanime
  // ----------------------------------------------------------
  getSettings() {
    return {
      episodeServers: ["VOSTFR", "VF"],
      supportsDub: true,
    };
  }

  // ----------------------------------------------------------
  //  1. RECHERCHE
  //  URL: /?s={query}&post_type=wp-manga
  //  Structure HTML:
  //    <div class="page-item-detail video">
  //      <div class="item-thumb" data-post-id="112254">
  //        <a href="/anime/slug/" title="Titre">
  //      </div>
  //      <div class="item-summary">
  //        <div class="post-title"><h3><a href="/anime/slug/">Titre</a></h3></div>
  //      </div>
  //    </div>
  // ----------------------------------------------------------
  async search(query) {
    try {
      var isVF = query.dub === true;
      var cleanQuery = query.query
        .replace(/saison\s+\d+/i, "")
        .replace(/season\s+\d+/i, "")
        .replace(/\bvf\b/i, "")
        .replace(/\bvostfr\b/i, "")
        .trim();

      var url = this.base + "/?s=" + encodeURIComponent(cleanQuery) + "&post_type=wp-manga";

      var res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });

      var html = await res.text();
      var results = [];

      // Extraire chaque bloc anime: <div class="page-item-detail video">
      var blockRegex = /<div[^>]*class="[^"]*page-item-detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
      var match;

      while ((match = blockRegex.exec(html)) !== null) {
        var block = match[1];

        // Titre et URL depuis .post-title h3 a
        var titleMatch = block.match(/<div[^>]*class="[^"]*post-title[^"]*"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/);
        if (!titleMatch) continue;

        var animeUrl = titleMatch[1];
        var title = titleMatch[2]
          .replace(/&#8217;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&#\d+;/g, "")
          .trim();

        // Post ID depuis data-post-id
        var postIdMatch = block.match(/data-post-id="(\d+)"/);
        var postId = postIdMatch ? postIdMatch[1] : "";

        // Détecter VF: titre contient "(VF)" ou slug finit par "-vf"
        var titleIsVF = title.toLowerCase().indexOf("(vf)") !== -1 ||
                        animeUrl.toLowerCase().indexOf("-vf/") !== -1 ||
                        animeUrl.toLowerCase().match(/\-vf\/?$/);

        // Filtrer selon la demande VF/VOSTFR
        if (isVF && !titleIsVF) continue;
        if (!isVF && titleIsVF) continue;

        // Extraire le slug
        var slugMatch = animeUrl.match(/\/anime\/([^\/]+)\/?$/);
        var slug = slugMatch ? slugMatch[1] : animeUrl;

        // Stocker le post_id dans l'id pour l'utiliser dans findEpisodes
        var id = postId ? slug + "|" + postId : slug;

        results.push({
          id: id,
          title: title,
          url: animeUrl,
          subOrDub: isVF ? "dub" : "sub",
        });
      }

      return results;
    } catch (e) {
      return [];
    }
  }

  // ----------------------------------------------------------
  //  2. LISTE DES ÉPISODES
  //  Utilise l'API AJAX Madara:
  //    POST /wp-admin/admin-ajax.php
  //    action=manga_get_chapters&manga={post_id}
  //
  //  Si pas de post_id, scrape la page anime et cherche
  //  data-id ou les liens d'épisodes directement.
  //
  //  Épisodes URL: /anime/{slug}/{ep-title}-{num}-{vf|vostfr}/
  // ----------------------------------------------------------
  async findEpisodes(id) {
    try {
      var parts = id.split("|");
      var slug = parts[0];
      var postId = parts[1] || "";

      // Si on n'a pas le post_id, scraper la page pour le trouver
      if (!postId) {
        var animeUrl = slug.startsWith("http") ? slug : this.base + "/anime/" + slug + "/";
        var pageRes = await fetch(animeUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9",
          },
        });
        var pageHtml = await pageRes.text();

        // Chercher le post ID dans #manga-chapters-holder ou data-id
        var pidMatch =
          pageHtml.match(/id="manga-chapters-holder"[^>]*data-id="(\d+)"/) ||
          pageHtml.match(/manga_id\s*=\s*["']?(\d+)["']?/) ||
          pageHtml.match(/"manga":\s*"?(\d+)"?/) ||
          pageHtml.match(/data-post-id="(\d+)"/);

        if (pidMatch) {
          postId = pidMatch[1];
        } else {
          // Fallback: extraire épisodes directement depuis le HTML de la page
          return this._extractEpisodesFromHtml(pageHtml, slug);
        }
      }

      // Appel AJAX pour récupérer les chapitres
      var formData = "action=manga_get_chapters&manga=" + postId;
      var ajaxRes = await fetch(this.ajaxUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": this.base + "/anime/" + slug + "/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: formData,
      });

      var ajaxHtml = await ajaxRes.text();

      if (!ajaxHtml || ajaxHtml === "0" || ajaxHtml === "") {
        // Fallback: scraper la page directement
        var animeUrl2 = this.base + "/anime/" + slug + "/";
        var pageRes2 = await fetch(animeUrl2, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        var pageHtml2 = await pageRes2.text();
        return this._extractEpisodesFromHtml(pageHtml2, slug);
      }

      return this._extractEpisodesFromHtml(ajaxHtml, slug);
    } catch (e) {
      return [];
    }
  }

  // Extrait les épisodes depuis du HTML (page anime ou réponse AJAX)
  _extractEpisodesFromHtml(html, slug) {
    var episodes = [];
    var seen = {};

    // Pattern Madara: <li class="wp-manga-chapter">
    //   <a href="/anime/slug/ep-slug-01-vostfr/">Titre Ep</a>
    var epRegex = /<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    var match;

    while ((match = epRegex.exec(html)) !== null) {
      var epUrl = match[1].trim();
      var epTitle = match[2].trim();
      if (seen[epUrl]) continue;
      seen[epUrl] = true;

      // Numéro d'épisode depuis l'URL ou le titre
      var numMatch =
        epUrl.match(/[-](\d+(?:\.\d+)?)-(?:vostfr|vf)\/?$/i) ||
        epTitle.match(/(\d+(?:\.\d+)?)\s*$/) ||
        epUrl.match(/[-](\d+(?:\.\d+)?)\/?$/);

      var epNum = numMatch ? parseFloat(numMatch[1]) : episodes.length + 1;

      // Slug de l'épisode
      var epSlugMatch = epUrl.match(/\/([^\/]+)\/?$/);
      var epId = epSlugMatch ? epSlugMatch[1] : epUrl;

      episodes.push({
        id: epId,
        title: epTitle || ("Épisode " + epNum),
        number: epNum,
        url: epUrl.startsWith("http") ? epUrl : this.base + epUrl,
      });
    }

    // Fallback: liens directs
    if (episodes.length === 0) {
      var linkRegex = /href="(https?:\/\/voir-anime\.to\/anime\/[^"]+\/[^"]+\/)"/g;
      var animeBase = this.base + "/anime/" + slug + "/";

      while ((match = linkRegex.exec(html)) !== null) {
        var epUrl = match[1];
        if (epUrl === animeBase || seen[epUrl]) continue;
        if (epUrl.indexOf(slug) === -1) continue;
        seen[epUrl] = true;

        var numMatch2 = epUrl.match(/[-](\d+(?:\.\d+)?)-(?:vostfr|vf)\/?$/i) ||
                        epUrl.match(/[-](\d+(?:\.\d+)?)\/?$/);
        var epNum2 = numMatch2 ? parseFloat(numMatch2[1]) : episodes.length + 1;

        var epSlugMatch2 = epUrl.match(/\/([^\/]+)\/?$/);
        episodes.push({
          id: epSlugMatch2 ? epSlugMatch2[1] : epUrl,
          title: "Épisode " + epNum2,
          number: epNum2,
          url: epUrl,
        });
      }
    }

    // Trier croissant
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
  }

  // ----------------------------------------------------------
  //  3. SOURCE VIDÉO D'UN ÉPISODE
  //  Page épisode: /anime/{slug}/{ep-slug}/
  //  Le thème Madara charge la vidéo via:
  //    - Un iframe dans .reading-content
  //    - Ou via AJAX: POST wp-admin/admin-ajax.php
  //      action=manga_get_reading_content
  //      chapter_id={id}&manga_id={id}
  // ----------------------------------------------------------
  async findEpisodeServer(episode, server) {
    try {
      var res = await fetch(episode.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": this.base + "/",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });

      var html = await res.text();

      // --- Étape 1: Chercher une iframe de lecteur vidéo ---
      var iframes = this._extractIframes(html);

      // --- Étape 2: Essayer chaque iframe ---
      for (var i = 0; i < iframes.length; i++) {
        try {
          var result = await this._resolvePlayerUrl(iframes[i], episode.url);
          if (result) {
            return {
              server: server || "VoirAnime",
              videoSources: [{ url: result.url, quality: "auto", type: result.type }],
            };
          }
        } catch (e2) {
          continue;
        }
      }

      // --- Étape 3: Chercher directement m3u8/mp4 dans la page ---
      var directResult = this._findVideoInHtml(html);
      if (directResult) {
        return {
          server: server || "VoirAnime",
          videoSources: [{ url: directResult.url, quality: "auto", type: directResult.type }],
        };
      }

      // --- Étape 4: Essai via AJAX Madara reading content ---
      var chapterIdMatch = html.match(/chapter_id\s*[=:]\s*["']?(\d+)["']?/) ||
                           html.match(/data-chapter="(\d+)"/);
      var mangaIdMatch   = html.match(/manga_id\s*[=:]\s*["']?(\d+)["']?/) ||
                           html.match(/data-manga="(\d+)"/);

      if (chapterIdMatch && mangaIdMatch) {
        var ajaxBody = "action=manga_get_reading_content" +
          "&chapter_id=" + chapterIdMatch[1] +
          "&manga_id=" + mangaIdMatch[1];

        var ajaxRes = await fetch(this.ajaxUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": episode.url,
          },
          body: ajaxBody,
        });

        var ajaxHtml = await ajaxRes.text();
        var ajaxIframes = this._extractIframes(ajaxHtml);

        for (var j = 0; j < ajaxIframes.length; j++) {
          try {
            var ajaxResult = await this._resolvePlayerUrl(ajaxIframes[j], episode.url);
            if (ajaxResult) {
              return {
                server: server || "VoirAnime",
                videoSources: [{ url: ajaxResult.url, quality: "auto", type: ajaxResult.type }],
              };
            }
          } catch (e3) {
            continue;
          }
        }

        var ajaxDirect = this._findVideoInHtml(ajaxHtml);
        if (ajaxDirect) {
          return {
            server: server || "VoirAnime",
            videoSources: [{ url: ajaxDirect.url, quality: "auto", type: ajaxDirect.type }],
          };
        }
      }

      throw new Error("Source vidéo introuvable.");
    } catch (e) {
      throw new Error("Erreur lecteur: " + e.message);
    }
  }

  // ----------------------------------------------------------
  //  Helpers
  // ----------------------------------------------------------

  _extractIframes(html) {
    var iframes = [];
    var regex = /<iframe[^>]*\s+src="([^"]{10,})"[^>]*>/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var src = match[1];
      if (src.startsWith("//")) src = "https:" + src;
      // Exclure les pubs et scripts non-vidéo
      if (
        src.indexOf("google") === -1 &&
        src.indexOf("facebook") === -1 &&
        src.indexOf("doubleclick") === -1 &&
        src.indexOf("twitter") === -1
      ) {
        iframes.push(src);
      }
    }
    return iframes;
  }

  _findVideoInHtml(html) {
    // m3u8
    var m3u8 =
      html.match(/["'](https?:\/\/[^"']+\.m3u8(?:\?[^"']*)?)['"]/i) ||
      html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i) ||
      html.match(/source\s+src=["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i);
    if (m3u8) return { url: m3u8[1], type: "hls" };

    // mp4
    var mp4 =
      html.match(/["'](https?:\/\/[^"']+\.mp4(?:\?[^"']*)?)['"]/i) ||
      html.match(/source\s+src=["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/i);
    if (mp4) return { url: mp4[1], type: "mp4" };

    return null;
  }

  async _resolvePlayerUrl(playerUrl, referer) {
    if (!playerUrl || playerUrl.length < 10) return null;
    if (playerUrl.startsWith("/")) playerUrl = this.base + playerUrl;

    var res = await fetch(playerUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": referer || this.base,
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    });

    var html = await res.text();

    // Chercher m3u8 / mp4 directement
    var direct = this._findVideoInHtml(html);
    if (direct) return direct;

    // Iframe imbriquée (1 niveau)
    var nested = html.match(/<iframe[^>]*\s+src=["']([^"']{10,})["'][^>]*>/i);
    if (nested) {
      var nestedSrc = nested[1];
      if (nestedSrc.startsWith("//")) nestedSrc = "https:" + nestedSrc;
      if (
        nestedSrc.indexOf("google") === -1 &&
        nestedSrc.indexOf("facebook") === -1 &&
        nestedSrc !== playerUrl
      ) {
        var res2 = await fetch(nestedSrc, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": playerUrl,
          },
        });
        var html2 = await res2.text();
        return this._findVideoInHtml(html2);
      }
    }

    return null;
  }
}
