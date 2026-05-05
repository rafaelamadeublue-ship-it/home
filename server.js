"use strict";

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 7000);
const HOST = process.env.HOST || "0.0.0.0";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const CACHE_MAX_AGE_SECONDS = Number(process.env.CACHE_MAX_AGE_SECONDS || 300);
const PUBLIC_ADDON_NAME = process.env.PUBLIC_ADDON_NAME || "Homeflix";
const HIDDEN_SOURCE_PATTERN = /\b(?:zmb|torrentio|ytztvio|streamx|thepiratebay|tpb)\+?\b/gi;

const SOURCES = [
  {
    id: "zmb",
    name: "ZMB",
    manifestUrl: "https://str.zmb.lat/manifest.json"
  },
  {
    id: "thepiratebay-plus",
    name: "ThePirateBay+",
    manifestUrl: "https://thepiratebay-plus.strem.fun/manifest.json"
  },
  {
    id: "ytztvio",
    name: "Ytztvio",
    manifestUrl: "https://ytztvio.galacticcapsule.workers.dev/manifest.json"
  },
  {
    id: "streamx",
    name: "StreamX",
    manifestUrl: "https://streamx.electron.al/manifest.json"
  }
].map((source) => ({
  ...source,
  baseUrl: source.manifestUrl.replace(/\/manifest\.json(?:\?.*)?$/i, "")
}));

const manifest = {
  id: "com.local.fontes.bundle",
  version: "1.0.0",
  name: PUBLIC_ADDON_NAME,
  description: "Addon Stremio com multiplas fontes de stream em uma unica lista.",
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt"]
    }
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: {
    configurable: false
  }
};

function sendJson(res, statusCode, payload, cacheSeconds = 0) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendOptions(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400"
  });
  res.end();
}

function parseStreamPath(pathname) {
  const match = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);
  if (!match) {
    return null;
  }

  return {
    type: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2])
  };
}

function encodeStremioPathSegment(value) {
  return encodeURIComponent(value).replace(/%3A/gi, ":");
}

function buildStreamUrl(source, type, id, search) {
  const upstreamUrl = new URL(
    `${source.baseUrl}/stream/${encodeStremioPathSegment(type)}/${encodeStremioPathSegment(id)}.json`
  );
  upstreamUrl.search = search;
  return upstreamUrl;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
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

function streamFingerprint(stream) {
  if (stream.infoHash) {
    return `hash:${String(stream.infoHash).toLowerCase()}:${stream.fileIdx ?? ""}`;
  }

  if (stream.url) {
    return `url:${stream.url}`;
  }

  if (stream.externalUrl) {
    return `external:${stream.externalUrl}`;
  }

  if (stream.ytId) {
    return `yt:${stream.ytId}`;
  }

  return [
    stream.name || "",
    stream.title || ""
  ].join("|");
}

function sanitizeSourceNames(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(HIDDEN_SOURCE_PATTERN, PUBLIC_ADDON_NAME).replace(/[ \t]{2,}/g, " ").trim();
}

function detectResolution(stream) {
  const candidates = [
    stream.behaviorHints && stream.behaviorHints.resolution,
    stream.tag,
    stream.name,
    stream.title
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const match = candidate.match(/\b(4k|2160p|1080p|720p|576p|480p)\b/i);
    if (match) {
      return match[1].toUpperCase().replace("P", "p");
    }
  }

  return "";
}

function withPublicLabel(stream) {
  const labeled = { ...stream };
  const resolution = detectResolution(labeled);

  labeled.name = resolution ? `${PUBLIC_ADDON_NAME} ${resolution}` : PUBLIC_ADDON_NAME;
  labeled.title = sanitizeSourceNames(labeled.title);
  labeled.description = sanitizeSourceNames(labeled.description);

  if (labeled.behaviorHints && typeof labeled.behaviorHints === "object") {
    labeled.behaviorHints = {
      ...labeled.behaviorHints,
      addonName: PUBLIC_ADDON_NAME
    };
  }

  return labeled;
}

async function getSourceStreams(source, type, id, search) {
  const streamUrl = buildStreamUrl(source, type, id, search);
  const payload = await fetchJson(streamUrl);
  const streams = Array.isArray(payload.streams) ? payload.streams : [];

  return streams.map((stream) => withPublicLabel(stream));
}

async function getStreams(type, id, search) {
  const results = await Promise.allSettled(
    SOURCES.map(async (source) => ({
      source,
      streams: await getSourceStreams(source, type, id, search)
    }))
  );

  const streams = [];
  const seen = new Set();

  for (const result of results) {
    if (result.status !== "fulfilled") {
      console.warn(`Fonte indisponivel: ${result.reason.message}`);
      continue;
    }

    for (const stream of result.value.streams) {
      const fingerprint = streamFingerprint(stream);
      if (seen.has(fingerprint)) {
        continue;
      }
      seen.add(fingerprint);
      streams.push(stream);
    }
  }

  return streams;
}

function getPublicBaseUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
  return `${protocol}://${req.headers.host || `127.0.0.1:${PORT}`}`;
}

function renderHome(req) {
  const baseUrl = getPublicBaseUrl(req);
  const manifestUrl = `${baseUrl}/manifest.json`;
  const stremioUrl = manifestUrl.replace(/^https?:\/\//, "stremio://");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${manifest.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.5; color: #151515; }
    main { max-width: 720px; }
    code { background: #f1f1f1; padding: 2px 5px; border-radius: 4px; }
    a { color: #2458d3; }
  </style>
</head>
<body>
  <main>
    <h1>${manifest.name}</h1>
    <p>${manifest.description}</p>
    <p><a href="${stremioUrl}">Instalar no Stremio</a></p>
    <p>Manifesto: <code>${manifestUrl}</code></p>
  </main>
</body>
</html>`;
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendOptions(res);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo nao permitido" });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    sendHtml(res, 200, renderHome(req));
    return;
  }

  if (requestUrl.pathname === "/manifest.json") {
    sendJson(res, 200, manifest, CACHE_MAX_AGE_SECONDS);
    return;
  }

  if (requestUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      sourceCount: SOURCES.length
    });
    return;
  }

  const streamParams = parseStreamPath(requestUrl.pathname);
  if (streamParams) {
    if (!manifest.types.includes(streamParams.type) || !streamParams.id.startsWith("tt")) {
      sendJson(res, 200, { streams: [] }, CACHE_MAX_AGE_SECONDS);
      return;
    }

    const streams = await getStreams(streamParams.type, streamParams.id, requestUrl.search);
    sendJson(res, 200, { streams }, CACHE_MAX_AGE_SECONDS);
    return;
  }

  sendJson(res, 404, { error: "Nao encontrado" });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "Erro interno" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Addon rodando em http://127.0.0.1:${PORT}/manifest.json`);
});
