'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const vault = require('./src/vault');
const auth = require('./src/auth');
const ssh = require('./src/ssh-sessions');

const PORT = process.env.PORT || 4022;
const ORIGIN = process.env.APP_ORIGIN || 'https://ssh.morenadoaco.com.br';
const app = express();
app.disable('x-powered-by');

// ---------- Headers de segurança (aplicados a todas as respostas) ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' wss:; manifest-src 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
  next();
});

app.use(express.json({ limit: '256kb' }));

// ---------- API ----------
const api = express.Router();

api.get('/state', (req, res) => {
  res.json({ setup: vault.isSetup(), authenticated: auth.isValid(auth.getToken(req)) });
});

api.post('/setup', (req, res) => {
  const rl = auth.checkRate(req);
  if (!rl.ok) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${rl.retryAfter}s.` });
  if (vault.isSetup()) return res.status(400).json({ error: 'Já configurado' });
  try {
    vault.setup(req.body.username, req.body.password);
    const token = auth.createToken();
    res.setHeader('Set-Cookie', auth.cookieHeader(token));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/login', (req, res) => {
  const rl = auth.checkRate(req);
  if (!rl.ok) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${rl.retryAfter}s.` });
  if (!vault.isSetup()) return res.status(400).json({ error: 'Não configurado' });
  try {
    if (!vault.unlock(req.body.username, req.body.password)) {
      auth.recordFail(req);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
    auth.recordSuccess(req);
    const token = auth.createToken();
    res.setHeader('Set-Cookie', auth.cookieHeader(token));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.post('/logout', (req, res) => {
  auth.destroy(auth.getToken(req));
  res.setHeader('Set-Cookie', auth.clearCookieHeader());
  res.json({ ok: true });
});

// Tudo abaixo exige autenticação.
api.use(auth.requireAuth);
// E o cofre precisa estar destravado (após restart do servidor exige novo login).
api.use((req, res, next) => {
  if (!vault.isUnlocked()) return res.status(423).json({ error: 'Cofre travado — faça login novamente' });
  next();
});

api.get('/servers', (req, res) => res.json({ servers: vault.list() }));
api.post('/servers', (req, res) => {
  try { res.json({ server: vault.add(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
api.put('/servers/:id', (req, res) => {
  try { res.json({ server: vault.update(req.params.id, req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
api.delete('/servers/:id', (req, res) => {
  try { vault.remove(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

api.get('/sessions', (req, res) => res.json({ sessions: ssh.list() }));
api.post('/sessions/:id/close', (req, res) => { ssh.close(req.params.id); res.json({ ok: true }); });

app.use('/api', api);

// ---------- Estáticos / PWA ----------
// Download do APK (força "salvar" no navegador do celular).
app.get('/downloads/ssh-morena.apk', (req, res) =>
  res.download(path.join(__dirname, 'public', 'downloads', 'ssh-morena.apk'), 'ssh-morena.apk'));
// Digital Asset Links — vincula o APK (TWA) ao domínio.
app.get('/.well-known/assetlinks.json', (req, res) =>
  res.type('application/json').sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Anti-CSWSH: se o navegador mandar Origin, ele precisa ser o nosso domínio.
  const origin = req.headers.origin;
  if (origin && origin !== ORIGIN) {
    return ws.close();
  }
  // Autenticação via cookie de sessão.
  if (!auth.isValid(auth.getToken(req)) || !vault.isUnlocked()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Não autenticado' }));
    return ws.close();
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'open': {
        const srv = vault.getRaw(msg.serverId);
        if (!srv) return ws.send(JSON.stringify({ type: 'error', message: 'Servidor não encontrado' }));
        const session = ssh.connect(srv, { cols: msg.cols, rows: msg.rows });
        ssh.attach(session.id, ws);
        ws.send(JSON.stringify({ type: 'opened', sessionId: session.id }));
        break;
      }
      case 'attach':
        if (!ssh.attach(msg.sessionId, ws)) ws.send(JSON.stringify({ type: 'error', message: 'Sessão não existe' }));
        break;
      case 'detach':
        ssh.detach(msg.sessionId, ws);
        break;
      case 'input':
        ssh.input(msg.sessionId, msg.data);
        break;
      case 'resize':
        ssh.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'close':
        ssh.close(msg.sessionId);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => ssh.detachAll(ws));
  ws.on('error', () => ssh.detachAll(ws));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ssh.morenadoaco.com.br backend ouvindo em 127.0.0.1:${PORT}`);
});
