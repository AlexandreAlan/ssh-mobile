'use strict';
// Teste de ponta a ponta: setup -> add servidor (chave, localhost:4219) -> abre sessão SSH via WS -> roda 'echo'.
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const BASE = 'http://127.0.0.1:4099';
let cookie = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = http.request(u, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
      let buf = ''; res.on('data', (c) => buf += c); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async () => {
  let r = await req('POST', '/api/setup', { username: 'tester', password: 'senha-de-teste-123' });
  console.log('setup', r.status, r.json);
  const key = fs.readFileSync(process.env.HOME + '/.ssh/id_ed25519', 'utf8');
  r = await req('POST', '/api/servers', { label: 'localhost-test', host: '127.0.0.1', port: 4219, username: process.env.USER, authType: 'key', privateKey: key });
  console.log('add server', r.status, r.json.server && r.json.server.id);
  const serverId = r.json.server.id;

  const ws = new WebSocket('ws://127.0.0.1:4099/ws', { headers: { Cookie: cookie } });
  let sessionId = null, got = '';
  const done = new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'open', serverId, cols: 80, rows: 24 })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'opened') sessionId = m.sessionId;
      if (m.type === 'status') { console.log('status:', m.status, m.error || ''); if (m.status === 'ready') setTimeout(() => ws.send(JSON.stringify({ type: 'input', sessionId, data: Buffer.from('echo PONTA_A_PONTA_OK\n').toString('base64') })), 300); }
      if (m.type === 'data') { got += Buffer.from(m.data, 'base64').toString(); if (got.includes('PONTA_A_PONTA_OK\r\n') || got.match(/PONTA_A_PONTA_OK[\s\S]*\$/)) resolve(true); }
    });
    setTimeout(() => resolve(false), 12000);
  });
  const ok = await done;
  console.log('SAÍDA SSH recebida?', ok && got.includes('PONTA_A_PONTA_OK'));
  ws.close();
  process.exit(ok ? 0 : 1);
})();
