// pm2 配置：npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'mahjong',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,                 // 单实例即可（游戏状态在进程内存中）
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        PORT: 3000,
        NODE_ENV: 'production'
      }
    }
  ]
};
