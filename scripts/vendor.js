'use strict';
// Copia os assets do xterm de node_modules pra public/vendor (versão offline pro PWA).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'public', 'vendor');
fs.mkdirSync(dest, { recursive: true });

const files = [
  ['node_modules/@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
];

for (const [src, name] of files) {
  fs.copyFileSync(path.join(root, src), path.join(dest, name));
  console.log('vendored', name);
}
