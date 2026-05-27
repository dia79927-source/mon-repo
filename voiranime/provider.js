/// <reference path="./online-streaming-provider.d.ts" />

// ============================================================
//  VoirAnime Provider for Seanime
//  Site: https://voir-anime.to
//  Langue : Français (VF & VOSTFR)
// ============================================================

class Provider {
  constructor() {
    this.base = "https://voir-anime.to";
  }

  // ----------------------------------------------------------
  //  Paramètres exposés dans l'interface Seanime
  // ----------------------------------------------------------
  getSettings() {
    return {
      episodeServers: ["VF", "VOSTFR"],
      supportsDub: true,
    };
  }

  // ----------------------------------------------------------
  //  1. RECHERCHE
  //  Endpoint : GET https://voir-anime.to/?s=<query>
  //  La page retourne une liste d'articles HTML avec :
  //    <article class="bs">
  //      <a href="/anime/slug/" title="Titre">
  //        <div class="tt">Titre</div>
  //      </a>
  //    </article>
  // ----------------------------------------------------------
  async search(query) {
    try {
      var cleanQuery = query.query
        .replace(/saison\s+\d+/i, "")
        .replace(/season\s+\d+/i, "")
        .replace(/\bvf\b/i, "")
        .replace(/\bvostfr\b/i, "")
        .trim();

      var res = await fetch(
        this.base + "/?s=" + encodeURIComponent(cleanQuery),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9",
          },
        }
      );

      var html = await res.text();
      var results = [];

      // Extraction des articles de résultats
      // Pattern: <article ...><a href="/anime/slug/" ...><div class="tt">Titre</div>
      var articleRegex = /<article[^>]*class="[^"]*bs[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
      var match;

      while ((match = articleRegex.exec(html)) !== null) {
        var block = match[1];

        // Extraire le lien
        var hrefMatch = block.match(/href="(https?:\/\/voir-anime\.to\/[^"]+|\/[^"]+)"/);
        // Extraire le titre depuis la balise <div class="tt"> ou <a title="...">
        var titleMatch =
          block.match(/<div[^>]*class="[^"]*tt[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
          block.match(/title="([^"]+)"/);

        if (!hrefMatch || !titleMatch) continue;

        var url = hrefMatch[1].startsWith("http")
          ? hrefMatch[1]
          : this.base + hrefMatch[1];

        var title = titleMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&#\d+;/g, "")
          .trim();

        if (!title || !url) continue;

        // Extraire le slug depuis l'URL : /anime/slug/ → "slug"
        var slugMatch = url.match(/\/anime\/([^\/]+)\/?$/);
        var slug = slugMatch ? slugMatch[1] : url.replace(this.base, "");

        results.push({
          id: slug,
          title: title,
          url: url,
          subOrDub: "sub",
        });
      }

      return results;
    } catch (e) {
      return [];
    }
  }

  // ----------------------------------------------------------
  //  2. LISTE DES ÉPISODES
  //  Page anime : https://voir-anime.to/anime/<slug>/
  //  Les épisodes sont dans une liste HTML :
  //    <div class="eplister">
  //      <ul>
  //        <li data-num="1">
  //          <a href="/episode/slug-episode-1/">
  //            <div class="epl-num">1</div>
  //            <div class="epl-title">Épisode 1</div>
  //          </a>
  //        </li>
  //      </ul>
  //    </div>
  // ----------------------------------------------------------
  async findEpisodes(id) {
    try {
      // Reconstituer l'URL de la page anime
      var animeUrl = id.startsWith("http")
        ? id
        : this.base + "/anime/" + id + "/";

      var res = await fetch(animeUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });

      var html = await res.text();
      var episodes = [];

      // --- Pattern 1 : balises <li> avec data-num et href d'épisode ---
      var liRegex = /<li[^>]*data-num="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
      var match;

      while ((match = liRegex.exec(html)) !== null) {
        var num = parseInt(match[1]);
        var block = match[2];

        var hrefMatch = block.match(/href="([^"]+)"/);
        var titleMatch =
          block.match(/<div[^>]*class="[^"]*epl-title[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
          block.match(/<span[^>]*>([\s\S]*?)<\/span>/);

        if (!hrefMatch) continue;

        var epUrl = hrefMatch[1].startsWith("http")
          ? hrefMatch[1]
          : this.base + hrefMatch[1];

        var epTitle = titleMatch
          ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
          : "Épisode " + num;

        if (!epTitle || epTitle === "") epTitle = "Épisode " + num;

        // Extraire l'id d'épisode depuis l'URL
        var epSlugMatch = epUrl.match(/\/([^\/]+)\/?$/);
        var epId = epSlugMatch ? epSlugMatch[1] : epUrl;

        episodes.push({
          id: epId,
          title: epTitle,
          number: num,
          url: epUrl,
        });
      }

      // --- Pattern 2 (fallback) : liens directs vers les épisodes ---
      if (episodes.length === 0) {
        var epLinkRegex = /href="(https?:\/\/voir-anime\.to\/[^"]*episode[^"]+)"/gi;
        var seen = {};
        var idx = 1;

        while ((match = epLinkRegex.exec(html)) !== null) {
          var epUrl = match[1];
          if (seen[epUrl]) continue;
          seen[epUrl] = true;

          // Numéro dans l'URL : /episode/slug-1/ ou /episode/slug-episode-1/
          var numMatch = epUrl.match(/[-](\d+)\/?$/);
          var epNum = numMatch ? parseInt(numMatch[1]) : idx;

          var epSlugMatch2 = epUrl.match(/\/([^\/]+)\/?$/);
          episodes.push({
            id: epSlugMatch2 ? epSlugMatch2[1] : epUrl,
            title: "Épisode " + epNum,
            number: epNum,
            url: epUrl,
          });
          idx++;
        }
      }

      // Trier par numéro croissant
      episodes.sort(function (a, b) { return a.number - b.number; });

      return episodes;
    } catch (e) {
      return [];
    }
  }

  // ----------------------------------------------------------
  //  3. SOURCE VIDÉO D'UN ÉPISODE
  //  Page épisode : https://voir-anime.to/episode/<slug>/
  //
  //  Stratégie :
  //    a) Trouver les serveurs disponibles (VF / VOSTFR) via des
  //       onglets ou une liste de lecteurs.
  //    b) Récupérer l'URL de l'iframe du lecteur demandé.
  //    c) Extraire le flux m3u8 ou mp4 depuis la page du lecteur.
  //
  //  Structure typique :
  //    <div class="mirror">
  //      <select name="mirror" id="selectMirror">
  //        <option data-index="0" data-src="https://player.../...">VF - Serveur 1</option>
  //      </select>
  //    </div>
  //    <div id="player"><iframe src="..."></iframe></div>
  // ----------------------------------------------------------
  async findEpisodeServer(episode, server) {
    try {
      var res = await fetch(episode.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "fr-FR,fr;q=0.9",
          "Referer": this.base + "/",
        },
      });

      var html = await res.text();

      // ---- Étape A : Collecter tous les serveurs disponibles ----
      var servers = this._extractServers(html, server);

      if (servers.length === 0) {
        throw new Error("Aucun serveur trouvé pour cet épisode.");
      }

      // ---- Étape B : Essayer chaque serveur dans l'ordre ----
      var videoUrl = null;
      var videoType = "hls";

      for (var i = 0; i < servers.length; i++) {
        var srv = servers[i];
        try {
          var result = await this._resolveServer(srv.url, episode.url);
          if (result) {
            videoUrl = result.url;
            videoType = result.type;
            break;
          }
        } catch (e2) {
          // Passer au serveur suivant
          continue;
        }
      }

      if (!videoUrl) {
        throw new Error("Impossible d'extraire la source vidéo.");
      }

      return {
        server: server || "VoirAnime",
        videoSources: [{ url: videoUrl, quality: "auto", type: videoType }],
      };
    } catch (e) {
      throw new Error("Erreur lors de la récupération du serveur : " + e.message);
    }
  }

  // ----------------------------------------------------------
  //  Helpers privés
  // ----------------------------------------------------------

  /**
   * Extrait la liste des serveurs disponibles depuis le HTML de la page épisode.
   * Retourne un tableau de { label, url }
   */
  _extractServers(html, preferredServer) {
    var servers = [];

    // --- Pattern 1 : <option data-src="URL">Label</option> ---
    var optRegex = /<option[^>]*data-src="([^"]+)"[^>]*>([^<]+)<\/option>/g;
    var match;
    while ((match = optRegex.exec(html)) !== null) {
      servers.push({ url: match[1], label: match[2].trim() });
    }

    // --- Pattern 2 : <li data-src="URL" class="...">Label</li> ---
    if (servers.length === 0) {
      var liRegex = /<li[^>]*data-(?:src|link|url)="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
      while ((match = liRegex.exec(html)) !== null) {
        var label = match[2].replace(/<[^>]+>/g, "").trim();
        servers.push({ url: match[1], label: label });
      }
    }

    // --- Pattern 3 : iframes directes ---
    if (servers.length === 0) {
      var iframeRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
      while ((match = iframeRegex.exec(html)) !== null) {
        var iframeSrc = match[1];
        // Exclure les iframes de réclame ou navigation
        if (
          iframeSrc.indexOf("google") === -1 &&
          iframeSrc.indexOf("facebook") === -1 &&
          iframeSrc.length > 20
        ) {
          servers.push({ url: iframeSrc, label: "Player" });
        }
      }
    }

    // Trier selon le serveur préféré (VF ou VOSTFR)
    if (preferredServer) {
      var pref = preferredServer.toUpperCase();
      servers.sort(function (a, b) {
        var aMatch = a.label.toUpperCase().indexOf(pref) !== -1 ? 0 : 1;
        var bMatch = b.label.toUpperCase().indexOf(pref) !== -1 ? 0 : 1;
        return aMatch - bMatch;
      });
    }

    return servers;
  }

  /**
   * Récupère la page du lecteur et en extrait le flux vidéo.
   * Retourne { url, type } ou null.
   */
  async _resolveServer(playerUrl, referer) {
    if (!playerUrl || playerUrl.length < 5) return null;

    // Résoudre les URL relatives
    if (playerUrl.startsWith("//")) playerUrl = "https:" + playerUrl;
    if (playerUrl.startsWith("/")) playerUrl = this.base + playerUrl;

    var res = await fetch(playerUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": referer || this.base,
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    var html = await res.text();

    // 1. Chercher un flux m3u8
    var m3u8Match =
      html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
      html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (m3u8Match) {
      return { url: m3u8Match[1], type: "hls" };
    }

    // 2. Chercher un fichier mp4 direct
    var mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"'?#]*)["'?#]/);
    if (mp4Match) {
      return { url: mp4Match[1], type: "mp4" };
    }

    // 3. Chercher "sources" dans du JS (pattern jwplayer / video.js)
    var sourcesMatch = html.match(
      /sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/
    );
    if (sourcesMatch) {
      var u = sourcesMatch[1];
      return {
        url: u,
        type: u.indexOf(".m3u8") !== -1 ? "hls" : "mp4",
      };
    }

    // 4. Iframe imbriquée — résoudre récursivement une seule fois
    var nestedIframe = html.match(/<iframe[^>]*src="([^"]{20,})"[^>]*>/i);
    if (nestedIframe) {
      var nestedUrl = nestedIframe[1];
      if (nestedUrl.startsWith("//")) nestedUrl = "https:" + nestedUrl;
      if (
        nestedUrl.indexOf("google") === -1 &&
        nestedUrl.indexOf("facebook") === -1
      ) {
        return await this._resolveServer(nestedUrl, playerUrl);
      }
    }

    return null;
  }
}
