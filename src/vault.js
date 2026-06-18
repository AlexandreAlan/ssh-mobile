'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveKey, hashPassword, verifyPassword, encrypt, decrypt } = require('./crypto');

const DATA_DIR = process.env.SSH_DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const VAULT_PATH = path.join(DATA_DIR, 'vault.enc');

// Estado em memória — só fica "destravado" enquanto o processo roda e após login válido.
let vaultKey = null;        // Buffer(32) derivado da senha mestra
let servers = [];           // lista de servidores em claro (apenas em RAM)

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function isSetup() {
  const c = readConfig();
  return !!(c && c.passwordHash);
}

function isUnlocked() {
  return vaultKey !== null;
}

// Primeira execução: define a senha mestra e cria o cofre vazio.
function setup(password) {
  if (isSetup()) throw new Error('Já configurado');
  if (!password || password.length < 8) throw new Error('A senha mestra precisa ter ao menos 8 caracteres');
  ensureDataDir();
  const vaultSalt = crypto.randomBytes(16).toString('hex');
  const config = { passwordHash: hashPassword(password), vaultSalt, createdAt: new Date().toISOString() };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  vaultKey = deriveKey(password, Buffer.from(vaultSalt, 'hex'));
  servers = [];
  persist();
}

// Verifica senha de login e destrava o cofre em memória.
function unlock(password) {
  const config = readConfig();
  if (!config) throw new Error('Não configurado');
  if (!verifyPassword(password, config.passwordHash)) return false;
  vaultKey = deriveKey(password, Buffer.from(config.vaultSalt, 'hex'));
  loadVault();
  return true;
}

function lock() {
  vaultKey = null;
  servers = [];
}

function loadVault() {
  if (!fs.existsSync(VAULT_PATH)) { servers = []; return; }
  try {
    const raw = decrypt(fs.readFileSync(VAULT_PATH, 'utf8'), vaultKey);
    servers = JSON.parse(raw);
  } catch (e) {
    throw new Error('Falha ao decifrar o cofre (senha incorreta ou arquivo corrompido)');
  }
}

function persist() {
  if (!vaultKey) throw new Error('Cofre travado');
  ensureDataDir();
  fs.writeFileSync(VAULT_PATH, encrypt(JSON.stringify(servers), vaultKey), { mode: 0o600 });
}

// Remove segredos antes de mandar pro cliente.
function sanitize(s) {
  return {
    id: s.id, label: s.label, host: s.host, port: s.port, username: s.username,
    authType: s.authType, hasPassword: !!s.password, hasKey: !!s.privateKey,
    hasPassphrase: !!s.passphrase, createdAt: s.createdAt,
  };
}

function list() {
  return servers.map(sanitize);
}

function getRaw(id) {
  return servers.find((s) => s.id === id) || null;
}

function add(input) {
  const s = {
    id: crypto.randomUUID(),
    label: (input.label || '').trim() || input.host,
    host: (input.host || '').trim(),
    port: Number(input.port) || 22,
    username: (input.username || '').trim() || 'root',
    authType: input.authType === 'key' ? 'key' : 'password',
    password: input.authType === 'key' ? '' : (input.password || ''),
    privateKey: input.authType === 'key' ? (input.privateKey || '') : '',
    passphrase: input.passphrase || '',
    createdAt: new Date().toISOString(),
  };
  if (!s.host) throw new Error('Host obrigatório');
  servers.push(s);
  persist();
  return sanitize(s);
}

function update(id, input) {
  const s = getRaw(id);
  if (!s) throw new Error('Servidor não encontrado');
  if (input.label !== undefined) s.label = input.label.trim() || s.host;
  if (input.host !== undefined) s.host = input.host.trim();
  if (input.port !== undefined) s.port = Number(input.port) || 22;
  if (input.username !== undefined) s.username = input.username.trim() || 'root';
  if (input.authType !== undefined) s.authType = input.authType === 'key' ? 'key' : 'password';
  // Campos secretos: só atualiza se vier valor (string não vazia), senão mantém.
  if (input.password) s.password = input.password;
  if (input.privateKey) s.privateKey = input.privateKey;
  if (input.passphrase !== undefined) s.passphrase = input.passphrase;
  if (s.authType === 'key') s.password = '';
  if (s.authType === 'password') { s.privateKey = ''; s.passphrase = ''; }
  persist();
  return sanitize(s);
}

function remove(id) {
  const before = servers.length;
  servers = servers.filter((s) => s.id !== id);
  if (servers.length === before) throw new Error('Servidor não encontrado');
  persist();
}

module.exports = {
  isSetup, isUnlocked, setup, unlock, lock,
  list, getRaw, add, update, remove,
};
