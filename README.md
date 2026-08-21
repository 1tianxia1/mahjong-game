# 在线麻将（Mahjong Online）

支持 **宁德麻将 / 福州麻将 / 川麻（血战到底）** 三种玩法，3~4 人实时联机，空位由 AI 机器人自动补位，单人也能开局。

- **架构**：Node.js + WebSocket（`ws`）实时多人联机；服务端权威引擎（防作弊），前端纯 HTML/CSS/JS 无需构建。
- **部署**：Node >= 18，`npm install && npm start` 即可；默认端口 `3000`（可用环境变量 `PORT` 覆盖）。
- **联机**：玩家用浏览器打开同一地址，输入昵称创建/加入房间，房主点「开始」后开局。

---

## 目录结构

```
mahjong-game/
├── src/
│   ├── tiles.js      # 牌定义与工具（34 种牌、索引/名称、牌袋生成）
│   ├── variants.js   # 三种玩法规则配置（金、三金倒、缺一门、血战到底…）
│   ├── scoring.js    # 胡牌判定（递归分解 / 七对 / 百搭）与番种计算
│   ├── engine.js     # 游戏引擎（发牌、翻金、摸打、碰杠胡、查叫、结算）
│   ├── ai.js         # AI 机器人（定缺、出牌、碰杠胡决策）
│   ├── room.js       # 房间管理（真人入座、AI 补位、断线托管、消息广播）
│   └── server.js     # HTTP 静态服务 + WebSocket 大厅/房间调度（入口）
├── public/           # 前端页面（大厅 / 等待室 / 牌桌）
├── test/
│   ├── engine.test.js  # 引擎单元测试 + 全 AI 整局冒烟测试（6 局）
│   └── ws_smoke.js     # WebSocket 端到端整局测试（4 局跑到结算）
├── deploy/           # 云服务器部署脚本（systemd / pm2 / nginx）
└── package.json
```

---

## 本地运行

```bash
cd mahjong-game
npm install
npm start        # 或 node src/server.js
# 打开 http://localhost:3000
```

跑测试：

```bash
npm test                              # 引擎单元 + 全 AI 整局（6 局，含分数合法性断言）
node test/ws_smoke.js                 # WS 端到端整局（需先启动服务器，4 局跑到结算）
node test/repro_nan.js                # 压力回归：50 轮 × 6 组合 = 300 局，防计分 NaN
```

---

## 三种玩法规则（当前实现，假设可纠偏）

> 通用标准规则：136 张（含东南西北中发白）。以下是各模式的本地化差异，**实现采用各地最常见规则，如与实际玩法不符可告知我调整。**

### 宁德麻将
- **金牌（百搭）**：翻牌确定金牌（按骰子点数从牌墙倒数），金牌可代替任意牌凑胡。
- **三金倒**：胡牌时手中有 ≥3 张金牌可直接胡（特殊胡法）。
- 有字牌；4 人局可玩；有人胡牌本局即结束。
- 最低 1 番起胡。

### 福州麻将
- **金牌（百搭）**：同样翻金，金牌百搭。
- **三金倒**：≥3 张金直接胡。
- 有字牌；最低 1 番起胡；有人胡牌本局即结束。

### 川麻（血战到底）
- **缺一门**：开局每人定缺一门花色，胡牌时手牌不能含定缺花色。
- **血战到底**：有人胡牌不结束，继续打，直到只剩一人未胡或牌墙摸完；先胡者赢分更多，可一炮多响。
- **刮风下雨**：明杠每家付 1 倍、暗杠每家付 2 倍、补杠（已碰再杠）也计分；杠分即时结算。
- **查叫**：牌墙摸完流局时，未胡牌者若听牌可向未听牌者收"查叫"分。
- 无字牌；记分翻倍制：得分 = 底分 × 2^(番-1)。

---

## 操作说明（牌桌）

- **定缺（川麻）**：开局选择要缺的一门花色。
- **出牌**：点自己手牌中的一张。
- **碰 / 杠 / 胡 / 过**：轮到"吃碰杠胡"决策时，操作面板出现对应按钮，点击即可。
- **断线**：真人中途断线会自动转为 AI 托管，重连后可继续观看。

---

## 云服务器部署

推荐方案：**nginx（静态+反代）+ systemd（守护进程）**。以下以 Ubuntu / 阿里云 Linux 为例。

### 1. 上传项目

```bash
scp -r mahjong-game root@你的服务器IP:/opt/
```

### 2. 安装依赖（服务器需 Node >= 18）

```bash
cd /opt/mahjong-game
npm install --omit=dev
```

### 3. systemd 守护（推荐）

```bash
cp deploy/mahjong.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mahjong
systemctl status mahjong        # 查看状态
journalctl -u mahjong -f        # 查看日志
```

服务文件见 [`deploy/mahjong.service`](deploy/mahjong.service)。

### 4. 或用 pm2（可选）

```bash
npm i -g pm2
cp deploy/ecosystem.config.js /opt/mahjong-game/
pm2 start ecosystem.config.js
pm2 save && pm2 startup        # 开机自启
```

### 5. nginx 反向代理 + WebSocket

```
server {
    listen 80;
    server_name 你的域名或IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket 必需
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

完整配置见 [`deploy/nginx.conf`](deploy/nginx.conf)。放行防火墙的 80 端口后，玩家访问 `http://服务器IP` 即可进房联机。

> 安全提示：公网直接开 `3000` 端口也可以玩（无需 nginx），但不建议在生产环境裸奔；用 nginx 后建议把服务只监听 `127.0.0.1`（修改服务文件中的 `PORT` 或直接反代即可）。

---

## 技术要点

- **无竞态设计**：引擎采用单 async 主循环，真人动作经 WS 提交、AI 动作经定时器提交，`await` 串行化，杜绝并发竞态。
- **防作弊**：状态下发仅包含自己手牌，他人手牌只显示背面；服务端全量校验每个动作合法性。
- **断线托管**：WS 断开后该座位自动切 AI 决策，不影响对局进行。
- **房间隔离**：每个房间独立 `Room`/`Game` 实例，互不干扰。
