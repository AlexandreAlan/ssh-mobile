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
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${TTL / 1000}`;
}
function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
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

module.exports = { createToken, isValid, destroy, getToken, cookieHeader, clearCookieHeader, requireAuth };
