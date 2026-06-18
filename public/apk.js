'use strict';
// Alterna as abas APK / PWA na página de instalação (sem JS inline, p/ CSP estrito).
function sw(w) {
  document.getElementById('tab-apk').classList.toggle('on', w === 'apk');
  document.getElementById('tab-pwa').classList.toggle('on', w === 'pwa');
  document.getElementById('pane-apk').classList.toggle('on', w === 'apk');
  document.getElementById('pane-pwa').classList.toggle('on', w === 'pwa');
}
document.querySelectorAll('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => sw(b.dataset.tab)));
