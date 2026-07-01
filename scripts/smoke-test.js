const http = require('http');
const { spawn } = require('child_process');

const env = { ...process.env, PAGECLAW_TOKEN: 'pc_local_dev', PAGECLAW_PORT: '3344' };
const server = spawn(process.execPath, ['bridge/server.js'], { env, stdio: 'inherit' });

setTimeout(async () => {
  try {
    await get('/healthz');
    await get('/v1');
    await get('/v1/models');
    console.log('PageClaw smoke test passed.');
    server.kill();
    process.exit(0);
  } catch (err) {
    console.error(err);
    server.kill();
    process.exit(1);
  }
}, 800);

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 3344, path }, (res) => {
      let raw = '';
      res.on('data', (d) => raw += d);
      res.on('end', () => res.statusCode < 400 ? resolve(raw) : reject(new Error(`${path} -> ${res.statusCode}`)));
    }).on('error', reject);
  });
}
