"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const BRAND = "HOMEFLIX";
const PORT = Number(process.env.PORT || 7200);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);
const LOGO_PATH = path.join(__dirname, "assets", "homeflix-logo.png");

const CATALOG_UPSTREAMS = [
  {
    key: "c1",
    baseUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club",
    catalogs: [
      { id: "nfx", type: "movie", name: "Netflix" },
      { id: "nfx", type: "series", name: "Netflix" },
      { id: "hbm", type: "movie", name: "HBO Max" },
      { id: "hbm", type: "series", name: "HBO Max" },
      { id: "dnp", type: "movie", name: "Disney+" },
      { id: "dnp", type: "series", name: "Disney+" },
      { id: "amp", type: "movie", name: "Prime Video" },
      { id: "amp", type: "series", name: "Prime Video" },
      { id: "atp", type: "movie", name: "Apple TV+" },
      { id: "atp", type: "series", name: "Apple TV+" }
    ]
  },
  {
    key: "c2",
    baseUrl: "https://top-streaming.stream/username=temporary_username",
    catalogs: [
      { id: "popular-movie-global", type: "movie", name: "Popular - Top 10 Global" },
      { id: "popular-series-global", type: "series", name: "Popular - Top 10 Global" }
    ],
    hasMeta: true
  }
];

const STREAM_UPSTREAMS = [
  {
    key: "s1",
    baseUrl: "https://torrentio.strem.fun",
    types: ["movie", "series", "anime"]
  },
  {
    key: "s2",
    baseUrl: "https://thepiratebay-plus.strem.fun",
    types: ["movie", "series"]
  },
  {
    key: "s3",
    baseUrl: "https://torrentsdb.com",
    types: ["movie", "series", "anime"]
  },
  {
    key: "s4",
    baseUrl: "https://ytztvio.galacticcapsule.workers.dev",
    types: ["movie", "series"]
  },
  {
    key: "s5",
    baseUrl: "https://str.zmb.lat/lite",
    types: ["movie", "series"]
  },
  {
    key: "s6",
    baseUrl: "https://streamx.electron.al",
    types: ["movie", "series"]
  },
  {
    key: "s7",
    baseUrl: "https://nebulastreams.onrender.com",
    types: ["movie", "series"]
  }
];

const BRAND_PATTERNS = [
  /\bnebula\s*streams?\b/gi,
  /\bnebulastreams?\b/gi,
  /\bstream\s*x\b/gi,
  /\bytzt?vi?o\b/gi,
  /\bytzvio\b/gi,
  /\btorrentio\b/gi,
  /\bthe\s*pirate\s*bay\+?\b/gi,
  /\btpb\+?\b/gi,
  /\btorrentsdb\b/gi,
  /\bzmb(?:\s*(?:lite|4k))?\b/gi,
  /\btop\s*streaming\b/gi,
  /\bstreaming\s*catalogs\b/gi,
  /\byts(?:\.mx)?\b/gi,
  /\byify\b/gi,
  /\beztv\b/gi,
  /\brarbg\b/gi,
  /\brargb\b/gi,
  /\b1337x\b/gi,
  /\btorrent\s*galaxy\b/gi,
  /\btorrentgalaxy\b/gi,
  /\btgx\b/gi,
  /\bmagnetdl\b/gi,
  /\bhorriblesubs\b/gi,
  /\bnyaa(?:si)?\b/gi,
  /\btokyo\s*tosho\b/gi,
  /\btokyotosho\b/gi,
  /\banidex\b/gi,
  /\brutor\b/gi,
  /\brutracker\b/gi,
  /\bkickass\s*torrents\b/gi,
  /\bkickasstorrents\b/gi,
  /\bbludv\b/gi,
  /\bmicoleaodublado\b/gi,
  /\btorrent9\b/gi,
  /\bilcorsaronero\b/gi,
  /\bmejortorrent\b/gi,
  /\bwolfmax4k\b/gi,
  /\bcinecalidad\b/gi,
  /\bbesttorrents\b/gi,
  /\btorrentcsv\b/gi,
  /\blime\s*torrents?\b/gi,
  /\blimetorrents?\b/gi,
  /\b1tamil(?:mv|blasters)\b/gi,
  /\bknaben\b/gi,
  /\bzamunda\b/gi,
  /\buindex\b/gi,
  /\btorrentproject2?\b/gi,
  /\boxtorrent\b/gi,
  /\bsk-?cztorrent\b/gi,
  /\banimetosho\b/gi,
  /\byggtorrent\b/gi
];

const catalogMap = new Map();
for (const upstream of CATALOG_UPSTREAMS) {
  for (const catalog of upstream.catalogs) {
    catalogMap.set(toPublicCatalogId(upstream.key, catalog.id), {
      upstream,
      catalog
    });
  }
}

function buildManifest(baseUrl) {
  return {
    id: "com.homeflix.addon",
    version: "1.0.0",
    name: BRAND,
    description: "Catalogs and streams gathered in one add-on, with sources sorted by peers.",
    logo: `${baseUrl}/logo.png`,
    background: `${baseUrl}/background.svg`,
    resources: [
      "catalog",
      "meta",
      {
        name: "stream",
        types: ["movie", "series", "anime"],
        idPrefixes: ["tt", "kitsu"]
      }
    ],
    types: ["movie", "series", "anime", "other"],
    catalogs: CATALOG_UPSTREAMS.flatMap((upstream) =>
      upstream.catalogs.map((catalog) => ({
        type: catalog.type,
        id: toPublicCatalogId(upstream.key, catalog.id),
        name: sanitizeText(catalog.name)
      }))
    ),
    idPrefixes: ["tt", "tmdb:", "kitsu"],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  };
}

function toPublicCatalogId(key, catalogId) {
  return `${key}-${catalogId}`;
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  });
  res.end(body);
}

function sendBuffer(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  });
  res.end(body);
}

function stripJsonSuffix(value) {
  return value.endsWith(".json") ? value.slice(0, -5) : value;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseAddonPath(pathname) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const resource = parts[0];

  if (!["catalog", "meta", "stream"].includes(resource) || parts.length < 3) {
    return null;
  }

  if (resource === "catalog" && parts.length >= 4) {
    return {
      resource,
      type: safeDecode(parts[1]),
      id: safeDecode(parts[2]),
      extra: stripJsonSuffix(parts.slice(3).join("/"))
    };
  }

  return {
    resource,
    type: safeDecode(parts[1]),
    id: safeDecode(stripJsonSuffix(parts[2])),
    extra: null
  };
}

function buildUpstreamUrl(baseUrl, resource, type, id, extra) {
  const pathParts = [resource, encodeURIComponent(type), encodeURIComponent(id)];
  if (extra) {
    pathParts.push(extra);
  } else {
    pathParts[pathParts.length - 1] += ".json";
  }

  if (extra) {
    pathParts[pathParts.length - 1] += ".json";
  }

  return `${baseUrl.replace(/\/+$/, "")}/${pathParts.join("/")}`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": `${BRAND}/1.0 StremioAddon`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCatalog(req, res, route) {
  const mapping = catalogMap.get(route.id);

  if (!mapping) {
    sendJson(res, 404, { metas: [] });
    return;
  }

  const { upstream, catalog } = mapping;
  const url = buildUpstreamUrl(upstream.baseUrl, "catalog", route.type, catalog.id, route.extra);

  try {
    const payload = await fetchJson(url);
    sendJson(res, 200, sanitizeCatalogPayload(payload));
  } catch (error) {
    sendJson(res, 200, { metas: [], error: `Falha ao carregar catalogo ${route.id}` });
  }
}

async function handleMeta(req, res, route) {
  const metaUpstreams = CATALOG_UPSTREAMS.filter((upstream) => upstream.hasMeta);

  for (const upstream of metaUpstreams) {
    const url = buildUpstreamUrl(upstream.baseUrl, "meta", route.type, route.id, route.extra);

    try {
      const payload = await fetchJson(url);
      if (payload && payload.meta) {
        sendJson(res, 200, sanitizeMetaPayload(payload));
        return;
      }
    } catch {
      // Try the next metadata source.
    }
  }

  sendJson(res, 404, { meta: null });
}

async function handleStream(req, res, route) {
  const tasks = STREAM_UPSTREAMS
    .filter((upstream) => upstream.types.includes(route.type))
    .map(async (upstream) => {
      const url = buildUpstreamUrl(upstream.baseUrl, "stream", route.type, route.id, route.extra);
      try {
        const payload = await fetchJson(url);
        const streams = Array.isArray(payload.streams) ? payload.streams : [];
        return streams.map((stream) => sanitizeStream(stream));
      } catch {
        return [];
      }
    });

  const results = await Promise.all(tasks);
  const streams = sortStreamsByPeers(dedupeStreams(results.flat()));
  sendJson(res, 200, { streams });
}

function sanitizeCatalogPayload(payload) {
  if (!payload || !Array.isArray(payload.metas)) {
    return { metas: [] };
  }

  return {
    ...payload,
    metas: payload.metas.map(sanitizeMeta)
  };
}

function sanitizeMetaPayload(payload) {
  if (!payload || !payload.meta) {
    return { meta: null };
  }

  return {
    ...payload,
    meta: sanitizeMeta(payload.meta)
  };
}

function sanitizeMeta(meta) {
  const next = { ...meta };

  for (const field of ["name", "description"]) {
    if (typeof next[field] === "string") {
      next[field] = sanitizeText(next[field]);
    }
  }

  if (Array.isArray(next.videos)) {
    next.videos = next.videos.map((video) => ({
      ...video,
      title: typeof video.title === "string" ? sanitizeText(video.title) : video.title
    }));
  }

  return next;
}

function sanitizeStream(stream) {
  const next = { ...stream };
  const fallbackTitle = [stream.name, stream.title].filter(Boolean).join("\n");
  const peerCount = extractPeerCount(stream);

  next.name = BRAND;
  next.title = sanitizeText(stream.title || fallbackTitle || BRAND);
  next.title = appendPeerInfo(next.title, peerCount);

  if (!next.title || next.title === BRAND) {
    next.title = BRAND;
    next.title = appendPeerInfo(next.title, peerCount);
  }

  if (typeof stream.description === "string") {
    next.description = sanitizeText(stream.description);
  }

  if (stream.behaviorHints && typeof stream.behaviorHints === "object") {
    next.behaviorHints = { ...stream.behaviorHints };
    for (const [key, value] of Object.entries(next.behaviorHints)) {
      if (shouldBrandBehaviorHintKey(key)) {
        next.behaviorHints[key] = BRAND;
      } else if (typeof value === "string") {
        next.behaviorHints[key] = sanitizeText(value);
      }
    }
  }

  return next;
}

function shouldBrandBehaviorHintKey(key) {
  return /^(addonName|indexerName|providerName|sourceName|trackerName)$/i.test(key);
}

function extractPeerCount(stream) {
  const directFields = [
    "peers",
    "peerCount",
    "seeders",
    "seeds",
    "seedCount",
    "seederCount",
    "seedersCount"
  ];

  for (const field of directFields) {
    const count = parsePeerNumber(stream[field]);
    if (count !== null) {
      return count;
    }
  }

  const nestedValues = [
    stream.behaviorHints && stream.behaviorHints.peers,
    stream.behaviorHints && stream.behaviorHints.seeders,
    stream.torrent && stream.torrent.peers,
    stream.torrent && stream.torrent.seeders,
    stream.stats && stream.stats.peers,
    stream.stats && stream.stats.seeders
  ];

  for (const value of nestedValues) {
    const count = parsePeerNumber(value);
    if (count !== null) {
      return count;
    }
  }

  const textValues = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints && stream.behaviorHints.bingeGroup,
    stream.behaviorHints && stream.behaviorHints.filename
  ].filter((value) => typeof value === "string");

  const patterns = [
    /(?:peers?|seeders?|seeds?)\s*[:=\-]?\s*([0-9][0-9.,]*\s*[kKmM]?)/i,
    /[\u{1F464}\u{1F465}]\s*([0-9][0-9.,]*\s*[kKmM]?)/iu,
    /([0-9][0-9.,]*\s*[kKmM]?)\s*(?:peers?|seeders?|seeds?)/i
  ];

  for (const text of textValues) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const count = match && parsePeerNumber(match[1]);
      if (count !== null) {
        return count;
      }
    }
  }

  return null;
}

function parsePeerNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, "");
  const match = normalized.match(/^([0-9][0-9.,]*)([kKmM]?)$/);
  if (!match) {
    return null;
  }

  const suffix = match[2].toLowerCase();
  let numeric = match[1];

  if (numeric.includes(",") && numeric.includes(".")) {
    numeric = numeric.replace(/,/g, "");
  } else if (numeric.includes(",") && !numeric.includes(".")) {
    numeric = numeric.replace(/,/g, "");
  }

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const multiplier = suffix === "m" ? 1000000 : suffix === "k" ? 1000 : 1;
  return Math.max(0, Math.round(parsed * multiplier));
}

function appendPeerInfo(title, peerCount) {
  if (peerCount === null || titleHasPeerLabel(title)) {
    return title;
  }

  return `${title}\nPeers: ${peerCount}`;
}

function titleHasPeerLabel(title) {
  return /(?:^|\n)\s*Peers:\s*[0-9]/i.test(title);
}

function sanitizeText(value) {
  if (typeof value !== "string") {
    return value;
  }

  let next = value;
  for (const pattern of BRAND_PATTERNS) {
    next = next.replace(pattern, BRAND);
  }

  return next
    .replace(/(\u2699\uFE0F?\s*)[^\n]+/gu, `$1${BRAND}`)
    .replace(/(\u{1F4E1}\s*)[^\n]+/gu, `$1${BRAND}`)
    .replace(/\[\s*ZOOMFLIX\s*\]/gi, BRAND)
    .replace(/\(\s*ZOOMFLIX\s*\)/gi, BRAND)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeStreams(streams) {
  const seen = new Set();
  const output = [];

  for (const stream of streams) {
    const key = [
      stream.infoHash || "",
      stream.fileIdx ?? "",
      stream.url || "",
      stream.externalUrl || "",
      stream.title || ""
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(stream);
  }

  return output;
}

function sortStreamsByPeers(streams) {
  return streams
    .map((stream, index) => ({
      stream,
      index,
      peers: extractPeerCount(stream)
    }))
    .sort((a, b) => {
      const left = a.peers === null ? -1 : a.peers;
      const right = b.peers === null ? -1 : b.peers;

      if (right !== left) {
        return right - left;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.stream);
}

function logoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#111827"/>
  <path d="M117 139h278L279 256l116 117H117l116-117L117 139Z" fill="#b91c1c"/>
  <path d="M156 173h158L198 339h158" fill="none" stroke="#fff7ed" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function backgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="#111827"/>
  <path d="M0 830C310 650 560 650 910 760s640 120 1010-90v410H0Z" fill="#7f1d1d"/>
  <path d="M0 0h1920v1080H0z" fill="none"/>
  <text x="960" y="548" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="132" font-weight="800" fill="#fff7ed">${BRAND}</text>
</svg>`;
}

function handleRoot(req, res) {
  const baseUrl = getBaseUrl(req);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${BRAND}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{width:min(920px,calc(100% - 40px));text-align:center}
    img{display:block;width:100%;height:auto;margin:0 auto 18px;filter:drop-shadow(0 18px 32px rgba(0,0,0,.35))}
    p{font-size:18px;line-height:1.5;color:#4b5563;margin:0}
    a{display:inline-flex;margin-top:20px;padding:12px 18px;border-radius:8px;background:#b91c1c;color:#fff;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <main>
    <img src="/logo.png" alt="${BRAND}">
    <p>Stremio add-on ready to install.</p>
    <a href="stremio://${baseUrl.replace(/^https?:\/\//, "")}/manifest.json">Install on Stremio</a>
  </main>
</body>
</html>`;

  sendText(res, 200, body, "text/html; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    sendText(res, 204, "");
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (pathname === "/" || pathname === "") {
    handleRoot(req, res);
    return;
  }

  if (pathname === "/manifest.json") {
    sendJson(res, 200, buildManifest(getBaseUrl(req)));
    return;
  }

  if (pathname === "/logo.png") {
    fs.readFile(LOGO_PATH, (error, data) => {
      if (error) {
        sendText(res, 200, logoSvg(), "image/svg+xml; charset=utf-8");
        return;
      }

      sendBuffer(res, 200, data, "image/png");
    });
    return;
  }

  if (pathname === "/logo.svg") {
    sendText(res, 200, logoSvg(), "image/svg+xml; charset=utf-8");
    return;
  }

  if (pathname === "/background.svg") {
    sendText(res, 200, backgroundSvg(), "image/svg+xml; charset=utf-8");
    return;
  }

  const route = parseAddonPath(pathname);
  if (!route) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (route.resource === "catalog") {
    await handleCatalog(req, res, route);
    return;
  }

  if (route.resource === "meta") {
    await handleMeta(req, res, route);
    return;
  }

  if (route.resource === "stream") {
    await handleStream(req, res, route);
    return;
  }
});

server.listen(PORT, () => {
  console.log(`${BRAND} Stremio addon running at http://localhost:${PORT}/manifest.json`);
});
