'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const repository = path.resolve(__dirname, '../..');
const prefixes = [
  '/templates/piraiders/slideshow/',
  '/templates/softpix/html/Template_Pack_1.4.0/',
  '/templates/softpix/ograf/Template_Pack_1.4.0/'
];
function pixels(width, height, rgb) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([...rgb, 255], offset);
  }
  return { width, height, data };
}
async function startFixtureServer() {
  const red = PNG.sync.write(pixels(320, 180, [240, 20, 20]));
  const green = PNG.sync.write(pixels(320, 180, [20, 220, 20]));
  const white = PNG.sync.write(pixels(320, 180, [255, 255, 255]));
  const blue = jpeg.encode(pixels(180, 320, [20, 20, 240]), 95).data;
  const requests = [];
  const sockets = new Set();
  const timers = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    requests.push(url.pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/harness') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:black"></body></html>');
      return;
    }
    if (url.pathname.startsWith('/piraiders/media/')) {
      const name = url.pathname.slice('/piraiders/media/'.length);
      const reply = () => {
        if (res.destroyed) return;
        if (name === 'missing.png') { res.writeHead(404); res.end(); return; }
        const bytes = name === 'corrupt.png' ? Buffer.from('not an image') :
          name === 'red.png' || name === 'delayed.png' ? red : name === 'green.png' ? green : name === 'white.png' ? white : name === 'portrait.jpg' ? blue : null;
        if (!bytes) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', name.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
        res.end(bytes);
      };
      if (name === 'delayed.png') {
        const timer = setTimeout(() => { timers.delete(timer); reply(); }, 650);
        timers.add(timer);
      } else reply();
      return;
    }
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (!prefixes.some(prefix => pathname.startsWith(prefix)) || pathname.split('/').includes('..') || pathname.includes('\\')) {
        res.writeHead(404); res.end(); return;
      }
      const local = path.join(repository, 'ASSETS', pathname);
      const type = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.ttf':'font/ttf', '.woff2':'font/woff2', '.png':'image/png' }[path.extname(local)];
      res.setHeader('Content-Type', type || 'application/octet-stream');
      res.end(await fs.readFile(local));
    } catch { res.writeHead(404); res.end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`, requests,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
module.exports = { startFixtureServer, repository };
