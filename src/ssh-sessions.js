'use strict';

const { Client } = require('ssh2');

// Buffer de saída por sessão (rolling). ~256 KB é suficiente pra reexibir a tela ao reconectar.
const MAX_BUFFER = 256 * 1024;

// sessionId -> Session
const sessions = new Map();

let idCounter = 1;

class Session {
  constructor(serverMeta) {
    this.id = `s${idCounter++}-${Date.now().toString(36)}`;
    this.serverId = serverMeta.id;
    this.label = serverMeta.label;
    this.host = serverMeta.host;
    this.username = serverMeta.username;
    this.status = 'connecting'; // connecting | ready | closed | error
    this.error = null;
    this.buffer = Buffer.alloc(0);
    this.cols = 80;
    this.rows = 24;
    this.clients = new Set(); // WebSockets atualmente "olhando" a sessão
    this.conn = null;
    this.stream = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  appendBuffer(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFER);
    }
    this.lastActivity = Date.now();
  }

  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  setStatus(status, error) {
    this.status = status;
    if (error) this.error = error;
    this.broadcast({ type: 'status', sessionId: this.id, status, error: error || null });
  }
}

function connect(serverRaw, opts = {}) {
  const session = new Session(serverRaw);
  session.cols = opts.cols || 80;
  session.rows = opts.rows || 24;
  sessions.set(session.id, session);

  const conn = new Client();
  session.conn = conn;

  const connectCfg = {
    host: serverRaw.host,
    port: serverRaw.port || 22,
    username: serverRaw.username || 'root',
    keepaliveInterval: 20000,   // mantém o túnel SSH vivo mesmo sem o celular conectado
    keepaliveCountMax: 6,
    readyTimeout: 25000,
  };
  if (serverRaw.authType === 'key' && serverRaw.privateKey) {
    connectCfg.privateKey = serverRaw.privateKey;
    if (serverRaw.passphrase) connectCfg.passphrase = serverRaw.passphrase;
  } else {
    connectCfg.password = serverRaw.password || '';
    // permite teclado-interativo com a mesma senha (alguns servidores exigem)
    connectCfg.tryKeyboard = true;
  }

  conn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
    finish(prompts.map(() => serverRaw.password || ''));
  });

  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: session.cols, rows: session.rows }, (err, stream) => {
      if (err) { session.setStatus('error', err.message); conn.end(); return; }
      session.stream = stream;
      session.setStatus('ready');
      stream.on('data', (d) => { session.appendBuffer(d); session.broadcast({ type: 'data', sessionId: session.id, data: d.toString('base64') }); });
      stream.stderr.on('data', (d) => { session.appendBuffer(d); session.broadcast({ type: 'data', sessionId: session.id, data: d.toString('base64') }); });
      stream.on('close', () => { session.setStatus('closed'); conn.end(); });
    });
  });

  conn.on('error', (err) => { session.setStatus('error', err.message); });
  conn.on('close', () => { if (session.status !== 'error') session.setStatus('closed'); });

  try {
    conn.connect(connectCfg);
  } catch (e) {
    session.setStatus('error', e.message);
  }
  return session;
}

function get(id) { return sessions.get(id) || null; }

function attach(id, ws) {
  const s = sessions.get(id);
  if (!s) return false;
  s.clients.add(ws);
  // Reenvia o estado atual + buffer pra "redesenhar" a tela no cliente que (re)conectou.
  ws.send(JSON.stringify({ type: 'attached', sessionId: s.id, status: s.status, error: s.error, cols: s.cols, rows: s.rows }));
  if (s.buffer.length) ws.send(JSON.stringify({ type: 'data', sessionId: s.id, data: s.buffer.toString('base64') }));
  return true;
}

function detach(id, ws) {
  const s = sessions.get(id);
  if (s) s.clients.delete(ws);
}

function detachAll(ws) {
  for (const s of sessions.values()) s.clients.delete(ws);
}

function input(id, dataB64) {
  const s = sessions.get(id);
  if (s && s.stream && s.status === 'ready') {
    s.stream.write(Buffer.from(dataB64, 'base64'));
    s.lastActivity = Date.now();
  }
}

function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (!s) return;
  s.cols = cols; s.rows = rows;
  if (s.stream && s.status === 'ready') {
    try { s.stream.setWindow(rows, cols, 0, 0); } catch {}
  }
}

function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  try { if (s.stream) s.stream.end(); } catch {}
  try { if (s.conn) s.conn.end(); } catch {}
  s.setStatus('closed');
  sessions.delete(id);
}

function list() {
  return [...sessions.values()].map((s) => ({
    id: s.id, serverId: s.serverId, label: s.label, host: s.host, username: s.username,
    status: s.status, error: s.error, viewers: s.clients.size,
    createdAt: s.createdAt, lastActivity: s.lastActivity,
  }));
}

// Limpeza de sessões mortas e ociosas (4h sem atividade e sem ninguém olhando).
const IDLE_LIMIT = 1000 * 60 * 60 * 4;
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.status === 'closed') { sessions.delete(id); continue; }
    if (s.clients.size === 0 && now - s.lastActivity > IDLE_LIMIT) close(id);
  }
}, 1000 * 60 * 5).unref();

module.exports = { connect, get, attach, detach, detachAll, input, resize, close, list };
