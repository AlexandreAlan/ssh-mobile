module.exports = {
  apps: [{
    name: 'ssh-morena',
    script: 'server.js',
    cwd: __dirname,
    env: { PORT: 4022, NODE_ENV: 'production' },
    max_memory_restart: '300M',
    autorestart: true,
  }],
};
