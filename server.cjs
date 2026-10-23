// Local server for the DSI Daily Delivery site.
// Serves the downloaded static files and re-creates the /api/state endpoint
// (GET = load shared progress, POST = save a task / milestone / metrics update).
// No dependencies: run with `node server.cjs`, then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'state.json');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const BUCKETS = { task: 'overrides', milestone: 'milestones', metrics: 'metrics' };

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { overrides: {}, metrics: {}, milestones: {}, audit: [], user: { name: 'RTP Team' } };
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function handleApi(req, res) {
  if (req.method === 'GET') {
    const s = loadState();
    return sendJson(res, 200, {
      overrides: s.overrides || {},
      metrics: s.metrics || {},
      milestones: s.milestones || {},
      audit: (s.audit || []).slice(0, 150),
      user: s.user || { name: 'RTP Team' },
      syncedAt: new Date().toISOString(),
    });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'Invalid JSON body.' }); }
    const { entityType, entityId, data, version } = body || {};
    const bucket = BUCKETS[entityType];
    if (!bucket || !entityId || typeof data !== 'object' || data === null) {
      return sendJson(res, 400, { error: 'The change could not be saved.' });
    }
    const s = loadState();
    s[bucket] = s[bucket] || {};
    s.audit = s.audit || [];
    const prev = s[bucket][entityId];
    const prevVersion = (prev && prev.version) || 0;
    if (typeof version === 'number' && version !== prevVersion) {
      return sendJson(res, 409, { error: 'This item was updated by someone else. Refresh and try again.' });
    }
    const now = new Date().toISOString();
    const actorName = (s.user && s.user.name) || 'RTP Team';
    const value = { ...data, version: prevVersion + 1, updatedAt: now, updatedBy: actorName };
    const event = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: now,
      actorName,
      entityType,
      entityId,
      payload: data,
      version: value.version,
    };
    s[bucket][entityId] = value;
    s.audit.unshift(event);
    s.syncedAt = now;
    saveState(s);
    sendJson(res, 200, { ok: true, value, event, syncedAt: now });
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') return handleApi(req, res);

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // Single-page app: unknown routes fall back to the main page.
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] }); res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`DSI Daily Delivery running at http://localhost:${PORT}`));
