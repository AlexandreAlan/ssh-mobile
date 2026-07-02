# SSH morenadoaco 📱⌘

Cliente **SSH para celular** (PWA instalável + APK Android) com **sessões persistentes**:
a conexão SSH vive no servidor, então ela continua ativa mesmo com o app **minimizado, com a tela bloqueada ou sem sinal**. Ao reabrir, o terminal reconecta e mostra tudo que aconteceu.

🌐 Em produção: **https://ssh.morenadoaco.com.br** · Instalação: **https://ssh.morenadoaco.com.br/apk**

## Recursos

- 🔐 **Cofre de credenciais criptografado** (AES-256-GCM) — senha mestra destrava; nada é salvo em claro.
- 🔑 Autenticação por **senha** ou **chave SSH privada** (com passphrase opcional).
- ♻️ **Sessões persistentes** no servidor (sobrevivem ao app fechar) + reexibição do histórico ao reconectar.
- 📜 Terminal completo (xterm.js) com teclas auxiliares mobile: `ctrl`, `alt`, `esc`, `tab`, setas, `^C`, `^D`.
- 📲 **PWA instalável** (tela cheia) **+ APK Android** assinado.
- 👥 Painel de **sessões ativas** — veja e reconecte em qualquer sessão aberta.

## Arquitetura

```
Celular (PWA/APK, xterm.js)  ⇄ WebSocket ⇄  Node (ssh.morenadoaco)  ⇄ SSH ⇄  Servidores-alvo
                                              └ sessão + buffer vivem AQUI ┘
```

O backend mantém o canal SSH aberto e um buffer de saída por sessão. O celular apenas
"assiste" via WebSocket; ao desconectar/reconectar, re-attacha à mesma sessão.

## Stack

- **Backend:** Node.js + Express + `ws` + `ssh2`
- **Frontend:** PWA (vanilla JS) + `@xterm/xterm`
- **Cripto:** Node `crypto` (scrypt + AES-256-GCM)
- **App Android:** WebView nativo (Gradle/AGP 8.5), tela cheia
- **Infra:** Nginx (reverse proxy + WebSocket) + Let's Encrypt + PM2

## Rodando localmente

```bash
npm install
npm run vendor        # copia o xterm pro /public/vendor (já versionado)
node server.js        # sobe em http://127.0.0.1:4022
```

Na primeira vez, abra o app e **defina usuário + senha mestra** — o usuário identifica o
login, a senha continua sendo o que deriva a chave que criptografa o cofre.
Os dados ficam em `data/` (ignorado pelo Git): `config.json` (usuário + hash da senha) e `vault.enc` (servidores cifrados).

> ⚠️ Não há recuperação de senha mestra: se esquecer, o cofre não abre. (É de propósito.)

Para já começar com conexões salvas, crie `data/seed-servers.json` antes da primeira
configuração — os servidores são importados pro cofre cifrado assim que a senha mestra
é definida, e o arquivo seed é apagado.

## Variáveis de ambiente

| Var | Padrão | Descrição |
|-----|--------|-----------|
| `PORT` | `4022` | Porta do backend |
| `SSH_DATA_DIR` | `./data` | Onde guardar `config.json` e `vault.enc` |

## Build do APK

Requer Android SDK (build-tools 34, platform 34) e JDK 17.

```bash
cd android-build
# crie keystore.properties (NÃO versionado) apontando pro seu keystore:
#   storeFile=../android.keystore
#   storePassword=...
#   keyAlias=...
#   keyPassword=...
gradle :app:assembleRelease
# saída: android-build/app/build/outputs/apk/release/app-release.apk
```

O `.well-known/assetlinks.json` (servido pelo backend) vincula o APK ao domínio
via fingerprint SHA-256 do certificado de assinatura.

## Segurança

- Senhas/chaves só existem **em claro na RAM** enquanto o cofre está destravado.
- Reinício do servidor **trava o cofre** (exige novo login). Sessões SSH ativas caem nesse caso.
- Tokens de sessão são aleatórios (32 bytes), HttpOnly, expiram em 30 dias.
- Sirva **sempre via HTTPS** (cookies e SSH passam por aí).
- **Anti-força-bruta**: `/login` e `/setup` limitados a 5 tentativas por IP (lockout de 15min).
- **Headers de segurança** em todas as respostas: CSP, HSTS, X-Frame-Options, nosniff.
- Cookie de sessão com flag **Secure**.
- **WebSocket valida `Origin`** (anti-CSWSH — cross-site WebSocket hijacking).
