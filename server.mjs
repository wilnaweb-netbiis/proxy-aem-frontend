import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import fs from 'node:fs';
import path from 'node:path';

const site = process.argv[2];
if (process.argv.length > 3 || (site !== undefined && !/^[a-zA-Z0-9_-]+$/.test(site))) {
  throw new Error('Uso: node server.mjs [site] (letras, numeros, "_" ou "-").');
}

const configFile = site === undefined ? 'proxy.config.mjs' : `proxy.config.${site}.mjs`;
let config;
try {
  ({ default: config } = await import(new URL(`./${configFile}`, import.meta.url)));
} catch (error) {
  throw new Error(`Falha ao carregar a configuracao ${configFile}: ${error.message}`, { cause: error });
}

const app = express();
app.disable('etag');
const prefix = config.localClientlibPrefix.replace(/\/$/, '');
const staticRoot = config.frontendDist;
const liveReloadScriptPath = '/__proxy_aem_live_reload.js';
const liveReloadEventsPath = '/__proxy_aem_live_reload_events';
const liveReloadClients = new Set();

app.use((req, res, next) => {
  if (!config.debug) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.locals.proxySource = 'REMOTO';
  res.locals.proxyDestination = `${config.target.replace(/\/$/, '')}${req.originalUrl}`;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `[REQUEST] ${req.method} ${req.originalUrl} -> ${res.locals.proxySource} `
      + `${res.locals.proxyDestination} | ${res.statusCode} | ${durationMs.toFixed(1)} ms`
    );
  });

  next();
});

function useLocalFile(res, file) {
  res.locals.proxySource = 'LOCAL';
  res.locals.proxyDestination = file;
}

function useInternalResource(res, resource) {
  res.locals.proxySource = 'INTERNO';
  res.locals.proxyDestination = resource;
}

function disableCache(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Expires: '0',
    Pragma: 'no-cache',
    'Surrogate-Control': 'no-store'
  });
}

function prepareProxyRequest(proxyReq, req) {
  proxyReq.removeHeader('origin');

  const referer = req.headers.referer;
  const localUrl = `${req.protocol}://${req.headers.host}`;
  if (req.method !== 'POST' || !referer || !URL.canParse(referer) || !URL.canParse(localUrl)) return;

  const refererUrl = new URL(referer);
  if (refererUrl.origin !== new URL(localUrl).origin) return;

  const targetOrigin = new URL(config.target).origin;
  proxyReq.setHeader('referer', `${targetOrigin}${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`);
}

function startLiveReloadWatcher() {
  if (!config.hotReload) return;

  let reloadTimer;
  const watcher = fs.watch(staticRoot, { recursive: true }, (_event, filename) => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const data = JSON.stringify({ file: filename ?? null, timestamp: Date.now() });
      for (const client of liveReloadClients) {
        client.write(`event: reload\ndata: ${data}\n\n`);
      }
      if (config.debug) console.log(`[RELOAD] Build alterado: ${filename ?? staticRoot}`);
    }, 150);
  });

  watcher.on('error', (error) => {
    console.error(`Falha ao observar o build local: ${error.message}`);
  });
  console.log(`Hot reload: ativo (${staticRoot})`);
}

app.get(liveReloadScriptPath, (_req, res) => {
  useInternalResource(res, liveReloadScriptPath);
  disableCache(res);
  res.type('application/javascript').send(`
    (() => {
      const events = new EventSource('${liveReloadEventsPath}');
      events.addEventListener('reload', () => window.location.reload());
    })();
  `);
});

app.get(liveReloadEventsPath, (req, res) => {
  useInternalResource(res, liveReloadEventsPath);
  res.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream'
  });
  res.write(': connected\n\n');
  liveReloadClients.add(res);
  req.on('close', () => liveReloadClients.delete(res));
});

function sendLocal(file, res) {
  useLocalFile(res, file);
  if (!fs.existsSync(file)) {
    res.status(503).type('text/plain').send(`Asset local ainda não foi gerado: ${file}`);
    return;
  }
  disableCache(res);
  res.sendFile(file, {
    cacheControl: false,
    etag: false,
    lastModified: false
  });
}

// Aceita URLs AEM com ou sem cache-busting, por exemplo clientlib-site.lc-<hash>.css.
app.get(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\.css$`), (_req, res) => {
  sendLocal(path.resolve(staticRoot, config.assets.css), res);
});
app.get(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\.js$`), (_req, res) => {
  sendLocal(path.resolve(staticRoot, config.assets.js), res);
});

// Fontes, imagens de CSS e source maps referenciados pela clientlib local.
app.use(prefix, express.static(staticRoot, {
  cacheControl: false,
  etag: false,
  fallthrough: true,
  lastModified: false,
  setHeaders(res, file) {
    useLocalFile(res, file);
    disableCache(res);
  }
}));

const htmlProxy = createProxyMiddleware({
  target: config.target,
  changeOrigin: true,
  secure: true,
  selfHandleResponse: true,
  on: {
    proxyReq: prepareProxyRequest,
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
      const contentType = proxyRes.headers['content-type'] ?? '';
      if (!contentType.includes('text/html')) return responseBuffer;

      const html = responseBuffer.toString('utf8');
      const script = `<script src="${liveReloadScriptPath}"></script>`;
      return /<\/body>/i.test(html)
        ? html.replace(/<\/body>/i, `${script}</body>`)
        : `${html}${script}`;
    })
  }
});

app.use((req, res, next) => {
  if (config.hotReload && req.method === 'GET' && req.headers.accept?.includes('text/html')) {
    htmlProxy(req, res, next);
    return;
  }
  next();
});

app.use('/', createProxyMiddleware({
  target: config.target,
  changeOrigin: true,
  secure: true,
  selfHandleResponse: false,
  on: {
    proxyReq: prepareProxyRequest
  }
}));

export const server = app.listen(config.port, (error) => {
  if (error) {
    console.error(`Falha ao iniciar o proxy na porta ${config.port}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Configuracao: ${configFile}`);
  console.log(`Proxy local: http://localhost:${config.port}`);
  console.log(`AEM remoto: ${config.target}`);
  console.log(`Clientlib local: ${prefix}`);
  console.log(`Build local: ${staticRoot}`);
  startLiveReloadWatcher();
});
