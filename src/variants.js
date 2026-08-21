// variants.js — 三种麻将模式的规则配置
//
// 重要说明（通用标准规则，便于后续纠偏）：
// 本文件集中描述每种玩法的“假设”。如果你本地规则有出入（番数、起胡线、金牌数量等），
// 直接改这里即可，无需动引擎代码。
//
// 公共字段：
//   key / name            标识与展示名
//   useHonors             是否使用字牌(东南西北中发白)。川麻=false，福州/宁德=true
//   jin                   是否有“金牌”(百搭)。福州/宁德=true，川麻=false
//   threeJinWin           持有几张金牌可直接胡（三金倒）。0=无
//   minFan                起胡：胡牌至少需要的总番数（含平胡1番）
//   queMen                是否“缺一门”（川麻专属，开局定缺）
//   bloodBattle           是否“血战到底”（有人胡后继续，直到剩1人/牌墙摸完）
//   basePoint             底分
//   fanWeights           各番种分值（见 scoring.js 用法）
//   scoring              'double'(翻倍) | 'add'(累加)

module.exports = {
  // ===== 宁德麻将（闽东玩法，参考福州系“金”规则）=====
  ningde: {
    key: 'ningde',
    name: '宁德麻将',
    useHonors: false,   // 宁德 112 张（万/筒/条 + 白板×4），不出 z0..z6
    useFixedJin: true,  // 固定金牌（不骰子翻金）
    jinTile: 33,        // 固定金 = 白板
    jin: true,
    threeJinWin: 3,        // 三金倒：拿3张金牌直接胡
    minFan: 1,             // 起胡1番（平胡即算1番，等于基本可胡）
    queMen: false,
    bloodBattle: false,
    basePoint: 1,
    scoring: 'add',        // 累加计分
    fanWeights: {
      pinghu: 1,           // 平胡
      zimo: 1,             // 自摸
      pengpeng: 2,         // 碰碰胡
      qingyise: 4,         // 清一色
      qidui: 4,            // 七对
      longqidui: 6,        // 龙七对（四张相同）
      menghing: 1,         // 门清（无吃碰，仅暗杠可）
      gang: 1,             // 每个杠
      jingou: 2,           // 金钩钓（四杠+将）
      jin: 2,              // 每张金牌额外加分
      gangshanghua: 2,     // 杠上开花
      qianggang: 2,        // 抢杠胡
      haidilao: 2,         // 海底捞月/炮
    },
  },

  // ===== 福州麻将（经典“金”玩法）=====
  fuzhou: {
    key: 'fuzhou',
    name: '福州麻将',
    useHonors: true,
    jin: true,
    threeJinWin: 3,        // 三金倒
    minFan: 1,
    queMen: false,
    bloodBattle: false,
    basePoint: 1,
    scoring: 'add',
    fanWeights: {
      pinghu: 1,
      zimo: 1,
      pengpeng: 2,
      qingyise: 4,
      qidui: 4,
      longqidui: 6,
      menghing: 1,
      gang: 1,
      jingou: 2,           // 金钩钓（四杠+将）
      jin: 2,              // 每张金
      gangshanghua: 2,
      qianggang: 2,
      haidilao: 2,
    },
  },

  // ===== 四川麻将（血战到底 / 缺一门）=====
  sichuan: {
    key: 'sichuan',
    name: '川麻(血战到底)',
    useHonors: false,      // 川麻无字牌
    jin: false,
    threeJinWin: 0,
    minFan: 1,             // 平胡1番起
    queMen: true,          // 缺一门
    bloodBattle: true,     // 血战到底
    basePoint: 1,
    scoring: 'double',     // 番数翻倍：score = base * 2^(fan-1)
    fanWeights: {
      pinghu: 1,
      zimo: 1,             // 自摸+1番
      menghing: 1,         // 门清
      pengpeng: 1,         // 碰碰胡
      qingyise: 2,         // 清一色
      qidui: 2,            // 七对
      longqidui: 3,        // 龙七对
      jingou: 2,           // 金钩钓（全杠）
      gang: 1,             // 每个杠
      gen: 1,             // 根（四张相同）+1番
      gangshanghua: 1,     // 杠上花
      qianggang: 1,        // 抢杠胡
      haidilao: 1,         // 海底
    },
    // 刮风下雨（杠）计分：点杠者付 / 各家付
    gangScore: {
      minggang: 2,         // 直杠(点杠)：点杠者付2
      angang: 1,           // 暗杠：每家付1
      bugang: 1,           // 补杠：每家付1
    },
    chaJiao: 1,            // 查叫：未胡且未听牌者，向每位胡牌者付此分
  },
};

// 启动自检：scoring.js 中会读取的番种权重键必须齐全，缺键会导致计分 NaN。
// jin 仅在启用金的变体需要；gen 仅在川麻需要（scoring.js 按 variant.key 读取）。
const REQUIRED_FAN_KEYS = ['pinghu', 'menghing', 'pengpeng', 'qingyise', 'qidui', 'longqidui', 'jingou', 'gang', 'gangshanghua', 'qianggang', 'haidilao', 'zimo'];
for (const [k, v] of Object.entries(module.exports)) {
  const need = REQUIRED_FAN_KEYS.slice();
  if (v.jin) need.push('jin');
  if (v.key === 'sichuan') need.push('gen');
  const miss = need.filter(n => !(n in v.fanWeights));
  if (miss.length) {
    throw new Error(`[variants] ${v.key} 的 fanWeights 缺少番种权重键: ${miss.join(', ')}（scoring.js 依赖这些键算分）`);
  }
}

