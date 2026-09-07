const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// URL de ton site web principal
const MY_COMMUNITY_SITE = "https://fstream.info/";
// URL de secours au cas où ton site ne répond pas
const DEFAULT_FALLBACK_URL = "https://publicdomainmovie.net";

/**
 * Fonction qui va lire ton site web pour trouver le lien du site du mois
 */
async function getTargetUrl() {
    try {
        const { data } = await axios.get(MY_COMMUNITY_SITE, { timeout: 5000 });
        const $ = cheerio.load(data);
        
        // Extrait le lien présent dans l'élément ayant l'id "websiteofthemoment"
        const dynamicUrl = $("#mainUrl a").attr("href") || $("#mainUrl").text().trim();
        
        if (dynamicUrl && dynamicUrl.startsWith("http")) {
            console.log(`[Addon] Site du mois récupéré : ${dynamicUrl}`);
            return dynamicUrl;
        }
    } catch (error) {
        console.error("[Addon] Impossible de contacter le site principal. Utilisation du site de secours :", error.message);
    }
    return DEFAULT_FALLBACK_URL;
}

// 1. Configuration du Manifest (Description de l'add-on)
const manifest = {
    id: "com.copyrightfreemoviz.addon",
    version: "1.0.0",
    name: "frenchstream - Le Choix du Mois",
    description: "Découvrez chaque mois une nouvelle sélection de films libres de droit choisis par la communauté !",
    resources: ["catalog", "stream"],
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

// 2. Traitement du Catalogue (Génération de la liste de films)
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

// 3. Traitement de la Lecture (Extraction du lien vidéo)
builder.defineStreamHandler(async (args) => {
    if (args.type === "movie" && args.id.startsWith("cfm:")) {
        try {
            const encodedUrl = args.id.replace("cfm:", "");
            const moviePageUrl = Buffer.from(encodedUrl, "base64").toString("utf-8");

            const { data } = await axios.get(moviePageUrl);
            const $ = cheerio.load(data);

            let streamUrl = $("video source").attr("src") || $("video").attr("src") || $("a[href$='.mp4']").attr("href");

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
            console.error("Erreur extraction stream :", e.message);
        }
    }
    return { streams: [] };
});

// 4. Lancement du serveur sur le port attribué par l'hébergeur (ou 7000 en local)
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
