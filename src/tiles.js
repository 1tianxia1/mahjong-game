// tiles.js — 麻将牌的基础定义与工具函数
// 牌的索引 0..33：
//   0-8   : 万(m) m1..m9
//   9-17  : 筒(p) p1..p9
//   18-26 : 条(s) s1..s9
//   27-33 : 字(z) z1..z7 = 东南西北中发白（其中 33 = 白板）
//
// ★本文件是「牌池定义的唯一真源」（架构 §9.1 第 1 条）：
//   任何玩法的牌池组成一律通过 VARIANT_TILE_SETS + getTileTypes(variant) 表达，
//   严禁在 engine.js / variants.js / 前端里硬编码 `t >= 27 && t <= 32` 之类的跳过逻辑。

const SUITS = ['m', 'p', 's', 'z'];

// 字牌名称
const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'];
// 花色前缀（用于前端显示）
const SUIT_LABEL = { m: '万', p: '筒', s: '条', z: '' };

// 字牌索引区间与白板常量（供 tile set 配置与测试引用，避免魔法数字散落）
const HONOR_MIN = 27;        // 东
const HONOR_MAX = 33;        // 白
const WHITE_DRAGON = 33;     // 白板：宁德玩法的固定金牌

function idxToStr(i) {
  const suit = Math.floor(i / 9);
  const num = (i % 9) + 1;
  return SUITS[suit] + num;
}

function strToIdx(s) {
  const suit = SUITS.indexOf(s[0]);
  const num = parseInt(s.slice(1), 10);
  return suit * 9 + (num - 1);
}

// 是否字牌
function isHonor(i) {
  return i >= HONOR_MIN;
}

// 花色索引 0=m,1=p,2=s,3=z
function suitOf(i) {
  return Math.floor(i / 9);
}

// 数字 1..9（字牌为 1..7）
function numberOf(i) {
  return (i % 9) + 1;
}

// 人类可读名称，用于日志/调试
function tileName(i) {
  const suit = suitOf(i);
  if (suit === 3) return HONOR_NAMES[i - HONOR_MIN];
  return numberOf(i) + SUIT_LABEL[SUITS[suit]];
}

// 用于前端渲染的 unicode 麻将牌字符（可选）
const TILE_UNICODE = {
  m: ['🀇','🀈','🀉','🀊','🀋','🀌','🀍','🀎','🀏'],
  p: ['🀙','🀚','🀛','🀜','🀝','🀞','🀟','🀠','🀡'],
  s: ['🀐','🀑','🀒','🀓','🀔','🀕','🀖','🀗','🀘'],
  z: ['🀀','🀁','🀂','🀃','🀄','🀅','🀆'],
};
function tileUnicode(i) {
  return TILE_UNICODE[SUITS[suitOf(i)]][i % 9];
}

// ---------------------------------------------------------------------------
// per-variant 牌池配置（数据层唯一真源）
// ---------------------------------------------------------------------------
/**
 * 每个玩法的牌池配置。
 *   useHonors     : 是否使用全部字牌（东南西北中发白 = 27..33）
 *   fixedJinIndex : 该玩法的固定金牌索引；null = 无固定金（走骰子翻金或无金）
 *                   当 useHonors=false 且该值 ≥27 时，该字牌会被单独补进牌池
 *   totalTiles    : 牌池总张数（= 用到的牌型数 × 4），仅作自检与展示用
 * @type {Object<string, {useHonors: boolean, fixedJinIndex: (number|null), totalTiles: number}>}
 */
const VARIANT_TILE_SETS = {
  // 宁德：万36 + 筒36 + 条36 + 白板4 = 112（无东南西北中发）
  ningde:  { useHonors: false, fixedJinIndex: WHITE_DRAGON, totalTiles: 112 },
  // 福州：标准 136 张（含全部字牌），金牌由骰子翻出
  fuzhou:  { useHonors: true,  fixedJinIndex: null,         totalTiles: 136 },
  // 川麻：万筒条 108 张，无字牌、无金
  sichuan: { useHonors: false, fixedJinIndex: null,         totalTiles: 108 },
};

const DEFAULT_TILE_SET = VARIANT_TILE_SETS.sichuan;

/**
 * 取某玩法的牌池配置。
 * 优先读 variant.tileSet（允许配置层直接覆盖），否则按 variant.key 查表，兜底为川麻。
 * @param {Object} variant variants.js 中的玩法配置对象
 * @returns {{useHonors: boolean, fixedJinIndex: (number|null), totalTiles: number}}
 */
function getTileSet(variant) {
  if (variant && variant.tileSet) return variant.tileSet;
  const key = variant && variant.key;
  return VARIANT_TILE_SETS[key] || DEFAULT_TILE_SET;
}

/**
 * 取某玩法牌池里实际出现的「牌型索引」升序数组（每型固定 4 张）。
 * 这是判断「某张牌在该玩法是否存在」的唯一入口（听牌枚举、牌池构造均复用）。
 * @param {Object} variant
 * @returns {number[]} 例：宁德 = [0..26, 33]（28 型 → 112 张）
 */
function getTileTypes(variant) {
  const set = getTileSet(variant);
  const types = [];
  for (let t = 0; t < HONOR_MIN; t++) types.push(t);          // 万/筒/条 恒定 27 型
  if (set.useHonors) {
    for (let t = HONOR_MIN; t <= HONOR_MAX; t++) types.push(t); // 全字牌
  } else if (set.fixedJinIndex != null && types.indexOf(set.fixedJinIndex) < 0) {
    types.push(set.fixedJinIndex);                              // 仅补固定金那一型（宁德=白板）
  }
  return types;
}

/**
 * 原地洗牌（Fisher-Yates）。engine.js 复用本实现，避免多份重复算法。
 * @param {any[]} arr
 * @returns {any[]} 同一个数组引用
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 按玩法构造整副牌（已洗牌）。新代码一律用本函数，勿再用 buildTileBag。
 * @param {Object} variant
 * @returns {number[]} 长度 === getTileSet(variant).totalTiles
 */
function buildVariantTileBag(variant) {
  const bag = [];
  for (const t of getTileTypes(variant)) {
    for (let c = 0; c < 4; c++) bag.push(t);
  }
  return shuffle(bag);
}

// 构造一副牌（返回的索引数组，含 4 张重复）
// 兼容保留：旧调用点/工具脚本仍可用；不洗牌，语义与 v1 完全一致。
function buildTileBag(useHonors) {
  const bag = [];
  const maxType = useHonors ? 34 : 27;
  for (let t = 0; t < maxType; t++) {
    for (let c = 0; c < 4; c++) bag.push(t);
  }
  return bag;
}

// 统计 hand（索引数组）为长度为 34 的计数数组
function toCounts(hand, ignoreIndex) {
  const counts = new Array(34).fill(0);
  for (const t of hand) {
    if (ignoreIndex != null && t === ignoreIndex) continue;
    counts[t]++;
  }
  return counts;
}

// 启动自检：牌型数 × 4 必须等于配置声明的 totalTiles，配置写错时立刻炸掉而不是牌局中途出怪。
for (const [key, set] of Object.entries(VARIANT_TILE_SETS)) {
  const actual = getTileTypes({ key }).length * 4;
  if (actual !== set.totalTiles) {
    throw new Error(`[tiles] ${key} 牌池自检失败：按配置构造得 ${actual} 张，但 totalTiles 声明为 ${set.totalTiles}`);
  }
}

module.exports = {
  SUITS, HONOR_NAMES, SUIT_LABEL, HONOR_MIN, HONOR_MAX, WHITE_DRAGON,
  idxToStr, strToIdx, isHonor, suitOf, numberOf, tileName, tileUnicode,
  buildTileBag, toCounts, shuffle,
  VARIANT_TILE_SETS, getTileSet, getTileTypes, buildVariantTileBag,
};
