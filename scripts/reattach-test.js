'use strict';
// Abre sessão, escreve marcador, FECHA o ws (simula app fechado), reconecta novo ws e re-attacha.
// Verifica que o histórico (buffer) é reexibido E que a sessão continuou viva.
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const BASE = 'http://127.0.0.1:4099';
let cookie = '';
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(new URL(BASE + path), { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await req('POST', '/api/login', { username: 'tester', password: 'senha-de-teste-123' });
  const list = (await req('GET', '/api/servers')).json.servers;
  const serverId = list[0].id;

  // ---- fase 1: abre sessão e escreve um marcador único ----
  const MARK = 'MARCADOR_' + Date.now();
  let sessionId = null;
  await new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:4099/ws', { headers: { Cookie: cookie } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'open', serverId, cols: 80, rows: 24 })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'opened') sessionId = m.sessionId;
      if (m.type === 'status' && m.status === 'ready') {
        ws.send(JSON.stringify({ type: 'input', sessionId, data: Buffer.from(`echo ${MARK}\n`).toString('base64') }));
        setTimeout(() => { ws.close(); resolve(); }, 800); // fecha "app"
      }
    });
  });
  console.log('fase 1: sessão', sessionId, 'criada e ws fechado');

  await wait(1500); // tempo "minimizado"

  // ---- fase 2: confirma que a sessão segue listada (viva no servidor) ----
  const sessions = (await req('GET', '/api/sessions')).json.sessions;
  const alive = sessions.find(s => s.id === sessionId && s.status === 'ready');
  console.log('fase 2: sessão ainda viva no servidor?', !!alive);

  // ---- fase 3: reconecta e re-attacha; deve receber o histórico com o marcador ----
  const replay = await new Promise((resolve) => {
    let buf = '';
    const ws = new WebSocket('ws://127.0.0.1:4099/ws', { headers: { Cookie: cookie } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'attach', sessionId })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'data') { buf += Buffer.from(m.data, 'base64').toString(); if (buf.includes(MARK)) { ws.close(); resolve(true); } }
    });
    setTimeout(() => resolve(false), 5000);
  });
  console.log('fase 3: histórico reexibido ao reconectar?', replay);
  process.exit(alive && replay ? 0 : 1);
})();
