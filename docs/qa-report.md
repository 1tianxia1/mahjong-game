# QA 验收报告 — 在线麻将 P0 六项改进（R-001 ~ R-006）

> **QA 工程师**：严过关
> **日期**：2026-08-21
> **项目路径**：`C:/Users/Y/WorkBuddy/2026-08-20-15-33-48/mahjong-game`
> **仓库状态**：非 git 仓库，未提交（按纪律不提交）
> **验收依据**：`docs/prd-improvement.md`（P0 验收标准）、`docs/architecture.md`（§4.3 音效差分 / §5 改造点 / §9 共享知识约定）

---

## 一、测试结果表

| 测试套件 | 命令 | 用例数 | 结果 | 备注 |
|---|---|---|---|---|
| engine.test.js | `node test/engine.test.js` | 7 | ✅ 全绿 | 胡牌判定 + 3 玩法 ×3/4 人整局冒烟 |
| multi_hu.test.js | `node test/multi_hu.test.js` | 5 | ✅ 全绿 | R-004 一炮多响专项回归 |
| repro_nan.js | `node test/repro_nan.js` | 50 轮 | ✅ 全绿 | 无 NaN 计分回归 |
| ws_smoke.js | `node test/ws_smoke.js` | 4 | ✅ 全绿 | 端到端整局（ningde/fuzhou/sichuan ×4p、sichuan ×3p 均跑到结算） |
| **sfx_events.test.js（新增）** | `node test/sfx_events.test.js` | 6 | ✅ 全绿 | R-006 `detectEvents` 优先级去重纯逻辑锁定 |

**`npm test` 现状**：`package.json` 的 `scripts.test` 已串联为新四件套
`engine.test.js && multi_hu.test.js && repro_nan.js && sfx_events.test.js`，复跑全绿。
`ws_smoke.js` 因需独立起服务，按纪律单独前后台运行（已验证 4/4）。

> 说明：前端 `public/js/*.js` 已通过 `node --check` 语法校验（主理人前置验证）；本 QA 额外对浏览器逻辑做了**人工代码走查 + 纯逻辑单测**（detection 差分），以覆盖 `--check` 无法捕获的**运行时引用/逻辑错误**。

---

## 二、逐项评审结论（R-001 ~ R-006）

### R-001 牌面图形化 — ✅ PASS
- **四类牌 DOM 正确**：`tileFaceHTML(i)`（`public/js/app.js:147-161`）中
  - 万(suit=0)：`<span class="rank">一~九</span><span class="wan">萬</span>`，红色 `--man`（`style.css:105-107`）；
  - 筒(suit=1)：`.pips.nN` + `<i class="pip p">`，径向圆点蓝 `--pin`（`style.css:110-117`）；
  - 条(suit=2)：`.pips.nN` + `<i class="pip s">`，竖竹条绿 `--sou`（`style.css:118-120`）；
  - 字(suit=3)：`.honor.h-*` 繁体大字，黑（`style.css:122-126`，其中 中=红/發=绿/白=蓝框，见「已知问题 KI-3」）。
- **尺寸走 CSS 变量**：`.tile{width:var(--tile-w);height:var(--tile-h)}`（`style.css:90-101`），`small/mini` 仅重定义变量（`style.css:102-103`），字号/点阵尺寸用 `calc(var(--tile-h)*…)` 自动等比缩放，**无硬编码像素牌尺寸**；移动端 `--tile-w:34/--tile-h:48`（`style.css:212`）。
- **金牌**：`tileHTML` 在 `state.jinIndex===i` 时加 `.jin` 类并追加 `<b class="jin-mark">金</b>`（`app.js:170-173`）；CSS 金框+光晕+金色角标（`style.css:136-140`）。
- **牌背纹样**：`.tile.back` 用 `repeating-linear-gradient` 交叉纹 + `::after` 方框（`style.css:128-133`），非纯色。
- **无遗留 emoji 牌面**：`tileFaceHTML/pipsHTML` 仅产出汉字与 `<i>` 元素，牌面零 emoji（emoji 仅出现在按钮 `ACT_ICON`，属 R-003 允许范围）。

### R-002 出牌两步确认 + 飞出 — ✅ PASS
- **两步确认**：`#board` 点击委托（`app.js:287-297`）—— 首次点 `.tile.discardable` → `selectTile` 加 `.sel`（`app.js:257-263`）；再次点同一 `data-idx` → `confirmDiscard()`。点空白取消（`app.js:289-292`）。
- **选中高亮**：`.tile.sel{transform:translateY(-10px) scale(1.05);outline:2px solid var(--gold);z-index:5}`（`style.css:143`）。
- **飞出动画脱离渲染树**：`Fx.flyTile()`（`app.js:365-385`）将牌克隆进 `#fxLayer`（`position:fixed;z-index:40`，`style.css:207`）做 `transform+opacity` 过渡（`.fx-tile`，`style.css:208`），不被 `renderBoard()` 的 `innerHTML=''` 打断。
- **先发 WS 再播动画（关键）**：`confirmDiscard()`（`app.js:268-284`）先 `sendAction({type:'discard',tile})`（`app.js:274-275`）提交，**后**才 `Fx.flyTile()`（`app.js:278-281`），**不占用回合倒计时**，符合 N-3 / §4.1 时序。

### R-003 动作按钮增强 — ✅ PASS
- **图标**：`mkBtn(cls,label,fn,icon)`（`app.js:348-355`）在 `icon` 存在时产出 `<span class="ico">…</span><span class="lbl">…</span>`；图标来自 `ACT_ICON` 常量（`app.js:300`，胡/碰/杠/吃/过/缺/出牌均有）。
- **尺寸 ≥44px**：`.btn-act{min-height:48px;min-width:64px}`（`style.css:172`），`@media(max-width:560px){.btn-act{min-height:44px;min-width:56px}}`（`style.css:220`），桌面/移动均达标。
- **胡按钮脉冲**：`.btn-act.hu{background:var(--danger);animation:huPulse 1.4s infinite}`（`style.css:181`）。
- **按下反馈**：`.btn-act:active{transform:scale(.95)}`（`style.css:177`）；另有 `:focus-visible` 描边。

### R-004 引擎（一炮多响修复）— ✅ PASS（已被单测覆盖）
- **返回契约 `{seats}`**：`resolveClaims()` 收集 `huSeats` 数组，`bloodBattle` 时返回全部、否则取最近一家 `[huSeats[0]]`，`return {type:'hu',seats,tile}`（`engine.js:379-396`）。
- **血战收集多家**：`huSeats.sort((x,y)=>dist(x)-dist(y))` 下家优先（`engine.js:393-394`）。
- **非血战只取最近一家**：`[huSeats[0]]`（`engine.js:394`），与 `dist()` 座次排序一致。
- **结算/终局解耦**：`doMultiRon(seats,discarder,tile,rob)`（`engine.js:258-274`）、`handleClaim()` 支持 `claim.seats`（`engine.js:402-415`）、`markWinner/checkGameEnd/continueAfterMultiWin`（`engine.js:422-439`）签名与调用一致，主循环统一走 `handleClaim`（`engine.js:343-348`）。
- **验证**：`engine.test.js` 7/7、`multi_hu.test.js` 5/5（含用例2 座位0=-4/座位1=+2/座位3=+2、用例3 非血战单家、用例4 座次序 `[3,0]`、用例5 终局无漏结算）。

### R-005 牌桌信息丰富化 — ✅ PASS
- **当前回合高亮**：`renderBoard()` 中 `if(phase==='playing' && pl.seat===state.current) seatDiv.classList.add('active')`（`app.js:193`）；CSS `.seat.active` 金边+发光+300ms 过渡（`style.css:82-86`）。
- **实时分数**：名字行 `<span class="score pos/neg/zero">±N</span>`（`app.js:201-203`），正金/负红/零弱（`style.css:73-76`）。
- **剩余牌数**：中央 `.center-info` 大号 `<span class="wall-count">${state.wallCount}</span>剩余牌`（`app.js:239`）；`wallCount` 由 `getState()` 提供（`engine.js:465`）。
- **最后弃牌高亮（防御性）**：严格按架构 §5.2 规则 —— 仅当 `state.lastDiscard` 存在 **且** `pl.seat===state.lastDiscard.seat` **且** `pl.discards[last]===state.lastDiscard.tile` 才加 `.last-discard`（`app.js:221-227`），规避「被碰/杠取走的牌误高亮」（对应 N-8/U-2）。
- **`youSeat` 注入已确认**：`renderBoard` 多处引用 `state.youSeat`（`app.js:189,229,344`），经核对 `room.broadcast()` 在下行时逐客户端注入 `st.youSeat=seat`（`src/room.js:121`），**运行时正确，无虚引用 Bug**。

### R-006 基础音效系统 — ✅ PASS
- **唯一入口**：`window.Sfx={play,setMuted,toggleMuted,isMuted,_ensureCtx}`（`sound.js:107`），`app.js` 仅经 `playSfx()` 间接调用（`app.js:19`），无直接 `new AudioContext()`。
- **五音覆盖**：`SOUND_PRESETS` 含 `deal(发牌)/discard(出牌)/meld(碰杠)/hu(胡牌)/liuju(流局)`（`sound.js:13-19`），全部 `Oscillator/BufferSource+Gain` 程序化合成，零音频文件、零外部请求（符合 §9.5 红线）。
- **优先级去重**：`detectEvents(prev,next)`（`app.js:390-406`）按 `['hu','liuju','meld','discard','deal']` 取最高一项，即 胡>流局>碰杠>出牌>发牌，与架构 §4.3 完全一致，并由新增 `sfx_events.test.js` 6/6 断言锁定（含同帧胡+出牌→胡、碰杠+出牌→碰杠、仅出牌→出牌、发牌、流局、全事件→hu）。
- **自动播放策略**：`ensureCtx()` 懒创建 `AudioContext`，并在 `document` 上挂一次性 `pointerdown/keydown` 执行 `ctx.resume()`（`sound.js:22-34`）。
- **静音开关**：`#muteBtn` 接入 `toggleMuted()` + 图标同步（`app.js:60-65`），状态持久化 `localStorage['mj_muted']`（`sound.js:99-105`）；`play()` 未初始化/静音/异常时静默返回且**绝不抛异常**（`sound.js:86-97`）。

---

## 三、发现的 Bug / 隐患清单

| 编号 | 文件:行号 | 现象 | 严重度 | 处理建议 |
|---|---|---|---|---|
| KI-1 | `public/js/app.js:282` 与 `app.js:113-114` | **出牌音效双重播放**：`confirmDiscard()` 在本地直接 `playSfx('discard')`，随后服务端回显的 `state` 经 `detectEvents` 再次判定 `lastDiscard` 变化 → 又播一次 `discard`，同一出牌听感上播两遍。 | 低 | 二选一：① 移除 `app.js:282` 的本地 `playSfx('discard')`，统一由 state 差分触发；② 或在 `confirmDiscard` 后设「本帧已播 discard」去重标记。不阻塞 P0，属打磨项。 |
| KI-2 | `public/css/style.css:187` | **死 CSS**：`.btn-act.confirm` 样式已定义但从未被使用（「出牌」确认按钮实际用 `.btn-act.sub`，见 `app.js:320`）。 | 极低（信息） | 可删除该行，或把出牌确认按钮改为 `confirm` 类以复用其配色。无害。 |
| KI-3 | `public/css/style.css:123-126` | **字牌配色与 PRD「字=黑」略有出入**：按写实惯例做了 中=红/發=绿/白=蓝框。 | 信息（已知） | 架构 §10 U-3 已列为待确认事项；若需严格统一为黑，删除 `.h-zhong/.h-fa/.h-bai` 三条覆盖规则即可（<5 分钟）。非缺陷。 |

> **结论**：未发现中等及以上严重度源码 Bug；上述 3 项均为低/极低严重度或可预期的已知设计差异，不影响任一 P0 验收标准，亦不影响四个测试套件全绿。

---

## 四、智能路由判定

**判定：`NoOne`（全部通过，无需返工）**

- 四套既有测试 + 新增 `sfx_events.test.js` **全部通过**，前端 JS 语法校验通过，代码走查 R-001~R-006 **均 PASS**。
- 未发现会导致 P0 验收失败的源码 Bug；发现的 3 项隐患（KI-1/2/3）严重度低、均不阻断 P0，交由主理人齐活林决定是否纳入后续打磨迭代。
- 依纪律：本次未自行大改源码（仅新增测试文件、将新测试串联进 `package.json` 的 `test` 脚本，属 trivial 测试辅助改动）。

---

## 五、已知问题数

**2 项需关注**（KI-1 出牌音效双重播放、KI-2 死 CSS），均低严重度；另有 1 项已知设计差异（KI-3，架构 U-3 已记录）。

- 阻塞性问题：0
- 建议返工项（供主理人决策）：KI-1（音效打磨）

---

*本文档为 P0 六项改进验收交付物，配套新增测试 `test/sfx_events.test.js` 已落盘并接入 `npm test`。*
