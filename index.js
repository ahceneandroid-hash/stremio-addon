const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MY_COMMUNITY_SITE = "https://fstream.info/";
const DEFAULT_FALLBACK_URL = "https://publicdomainmovie.net";

async function getTargetUrl() {
    try {
        const { data } = await axios.get(MY_COMMUNITY_SITE, { timeout: 5000 });
        const $ = cheerio.load(data);
        const dynamicUrl = $("#mainUrl a").attr("href") || $("#mainUrl").text().trim();
        
        if (dynamicUrl && dynamicUrl.startsWith("http")) {
            return dynamicUrl;
        }
    } catch (error) {
        console.error("[Addon] Erreur site principal, bascule sur fallback :", error.message);
    }
    return DEFAULT_FALLBACK_URL;
}

// 1. Manifest : Ajout de "meta" dans les ressources
const manifest = {
    id: "com.copyrightfreemoviz.addon",
    version: "1.0.1",
    name: "CopyrightFreeMoviz - Le Choix du Mois",
    description: "Découvrez chaque mois une nouvelle sélection de films libres de droit !",
    resources: ["catalog", "meta", "stream"], // <--- "meta" ajouté ici
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "cfm_monthly_catalog",
            name: "Découverte du Mois"
        }
    ]
};

const builder = new addonBuilder(manifest);

// 2. Gestion du Catalogue
builder.defineCatalogHandler(async (args) => {
    if (args.type === "movie" && args.id === "cfm_monthly_catalog") {
        try {
            const targetUrl = await getTargetUrl();
            const { data } = await axios.get(targetUrl);
            const $ = cheerio.load(data);
            const metas = [];

            $("a").each((i, el) => {
                const href = $(el).attr("href");
                const imgEl = $(el).find("img").first();
                const title = $(el).text().trim() || imgEl.attr("alt");

                if (href && title && title.length > 2 && !href.startsWith("#") && !href.startsWith("javascript")) {
                    let fullMovieLink = href;
                    if (!href.startsWith("http")) {
                        const urlObj = new URL(targetUrl);
                        fullMovieLink = `${urlObj.origin}${href.startsWith("/") ? "" : "/"}${href}`;
                    }

                    const encodedId = Buffer.from(fullMovieLink).toString("base64");

                    metas.push({
                        id: `cfm:${encodedId}`,
                        type: "movie",
                        name: title,
                        poster: imgEl.attr("src") ? (imgEl.attr("src").startsWith("http") ? imgEl.attr("src") : new URL(targetUrl).origin + imgEl.attr("src")) : null
                    });
                }
            });

            const uniqueMetas = Array.from(new Map(metas.map(m => [m.id, m])).values());
            return { metas: uniqueMetas.slice(0, 50) };
        } catch (e) {
            console.error("Erreur catalogue :", e.message);
            return { metas: [] };
        }
    }
    return { metas: [] };
});

// 3. NOUVEAU : Handler de Métadonnées (Affiche la page du film dans Stremio)
builder.defineMetaHandler(async (args) => {
    if (args.type === "movie" && args.id.startsWith("cfm:")) {
        try {
            const encodedUrl = args.id.replace("cfm:", "");
            const moviePageUrl = Buffer.from(encodedUrl, "base64").toString("utf-8");

            const { data } = await axios.get(moviePageUrl);
            const $ = cheerio.load(data);

            const title = $("h1").first().text().trim() || "Film";
            const description = $("p").first().text().trim() || "Aucune description disponible.";
            const poster = $("img").first().attr("src");

            return {
                meta: {
                    id: args.id,
                    type: "movie",
                    name: title,
                    description: description,
                    poster: poster ? (poster.startsWith("http") ? poster : new URL(moviePageUrl).origin + poster) : null
                }
            };
        } catch (e) {
            console.error("Erreur meta :", e.message);
        }
    }
    return { meta: null };
});

// 4. Gestion des Streams
builder.defineStreamHandler(async (args) => {
    if (args.type === "movie" && args.id.startsWith("cfm:")) {
        try {
            const encodedUrl = args.id.replace("cfm:", "");
            const moviePageUrl = Buffer.from(encodedUrl, "base64").toString("utf-8");

            const { data } = await axios.get(moviePageUrl);
            const $ = cheerio.load(data);

            let streamUrl = $("video source").attr("src") 
                         || $("video").attr("src") 
                         || $("a[href$='.mp4']").attr("href")
                         || $("iframe").attr("src"); // Ajout du support iFrame (ex: Archive.org)

            if (streamUrl && !streamUrl.startsWith("http")) {
                const origin = new URL(moviePageUrl).origin;
                streamUrl = `${origin}${streamUrl.startsWith("/") ? "" : "/"}${streamUrl}`;
            }

            if (streamUrl) {
                return {
                    streams: [{
                        title: "Lecture Directe",
                        url: streamUrl
                    }]
                };
            }
        } catch (e) {
            console.error("Erreur stream :", e.message);
        }
    }
    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });

