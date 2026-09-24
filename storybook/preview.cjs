const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url.pathname !== '/' && url.pathname !== '/My_Storybook.html') { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(path.join(root,'My_Storybook.html')).pipe(res);
});
const port = Number(process.argv[2] || 8765);
server.listen(port,'127.0.0.1',() => console.log('Storybook preview: http://127.0.0.1:'+port));
