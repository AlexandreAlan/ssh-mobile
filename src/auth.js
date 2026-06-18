'use strict';

const crypto = require('crypto');

// Tokens de sessão em memória: token -> expiraEm (ms).
const sessions = new Map();
const TTL = 1000 * 60 * 60 * 24 * 30; // 30 dias

function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TTL);
  return token;
}

function isValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}

function destroy(token) {
  if (token) sessions.delete(token);
}

// ---- Proteção contra força bruta (por IP) ----
// Após MAX_FAILS tentativas erradas numa janela, bloqueia o IP por BLOCK ms.
const attempts = new Map(); // ip -> { count, first, blockedUntil }
const MAX_FAILS = 5;
const WINDOW = 1000 * 60 * 15;  // 15 min
const BLOCK = 1000 * 60 * 15;   // bloqueio de 15 min

function clientIp(req) {
  // Atrás do nginx: o IP real vem em X-Forwarded-For (primeiro da lista).
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}

// Retorna {ok:true} ou {ok:false, retryAfter} se o IP estiver bloqueado.
function checkRate(req) {
  const ip = clientIp(req);
  const rec = attempts.get(ip);
  const now = Date.now();
  if (rec && rec.blockedUntil && now < rec.blockedUntil) {
    return { ok: false, retryAfter: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  return { ok: true };
}

function recordFail(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW) rec = { count: 0, first: now, blockedUntil: 0 };
  rec.count++;
  if (rec.count >= MAX_FAILS) rec.blockedUntil = now + BLOCK;
  attempts.set(ip, rec);
}

function recordSuccess(req) {
  attempts.delete(clientIp(req));
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function getToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.sid || null;
}

const COOKIE = 'sid';
function cookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${TTL / 1000}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}

function requireAuth(req, res, next) {
  if (isValid(getToken(req))) return next();
  return res.status(401).json({ error: 'Não autenticado' });
}

// Limpa tokens expirados periodicamente.
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (now > exp) sessions.delete(t);
}, 1000 * 60 * 60).unref();

module.exports = {
  createToken, isValid, destroy, getToken, cookieHeader, clearCookieHeader, requireAuth,
  checkRate, recordFail, recordSuccess, clientIp,
};
