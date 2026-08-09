// Zero-dependency static server for the no-build app. Serves the repo root
// with correct MIME types and PWA-friendly headers. Run: npm run serve
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8123);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Prevent path traversal outside the repo root.
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': type };
      // Never cache the app shell or the service worker; cache the rest.
      if (pathname === '/sw.js' || pathname === '/index.html') {
        headers['Cache-Control'] = 'no-cache';
      } else {
        headers['Cache-Control'] = 'public, max-age=3600';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  } catch (err) {
    res.writeHead(400);
    res.end('Bad request');
  }
});

server.listen(PORT, () => {
  console.log('Kanban served at http://localhost:' + PORT + '/');
});
