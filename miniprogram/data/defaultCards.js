/**
 * 内置题库开关机制（2026-09-10）
 *
 * 设计：内置题库单独放在 builtinLocal.js，由 scripts/build_builtin_cards.cjs 生成。
 *   - 本地自用：跑 `--write` → ENABLED:true + 全套题，本地随便刷
 *   - 提交发布：跑 `--clean` → ENABLED:false + 空数组，代码包不含任何题目
 *
 * 为何不直接用 INITIAL_CARDS 写死：小程序上传的是「开发者工具本地文件」，
 * 与 git 无关，.gitignore 对上传无效；开关必须体现在文件内容本身。
 *
 * 优先级：本地 Storage 有数据 → 用本地（用户导入的题不会被覆盖）。
 * 详见 store.getCards()。
 *
 * 存量设备上已存储的内置卡（caq-bb-* 前缀）由 store.getCards() 自动清除。
 */
const SAMPLE_CARDS = require('./sampleCards.js').SAMPLE_CARDS;

let BUILTIN_CARDS = [];
try {
  const m = require('./builtinLocal.js');
  if (m && m.ENABLED !== false && Array.isArray(m.BUILTIN_CARDS)) {
    BUILTIN_CARDS = m.BUILTIN_CARDS;
  }
} catch (e) {
  // builtinLocal.js 缺失或异常 → 空库启动，不影响正常运行
  BUILTIN_CARDS = [];
}

// 示例卡常驻（发布版也保留，供审核与首次体验）；内置题库受 ENABLED 开关控制，发布前 --clean 清空
const INITIAL_CARDS = SAMPLE_CARDS.concat(BUILTIN_CARDS);

const DMAIC_STAGES = [
  { id: 'overview', name: '概述', shortName: '概述', desc: '六西格玛管理概论/领导力' },
  { id: 'define', name: 'D 界定阶段', shortName: 'D 界定', desc: 'VOC/Charter/SIPOC' },
  { id: 'measure', name: 'M 测量阶段', shortName: 'M 测量', desc: 'MSA/过程能力/CPK' },
  { id: 'analyze', name: 'A 分析阶段', shortName: 'A 分析', desc: '假设检验/ANOVA/回归' },
  { id: 'improve', name: 'I 改进阶段', shortName: 'I 改进', desc: 'DOE试验设计/响应曲面' },
  { id: 'control', name: 'C 控制阶段', shortName: 'C 控制', desc: 'SPC控制图/判异准则/SOP' },
  { id: 'lean', name: '精益工具', shortName: '精益工具', desc: 'VSM/SMED/看板/防错' },
  { id: 'dfss', name: '六西格玛设计', shortName: 'DFSS设计', desc: 'DFMA/DFMAC/DMADV' },
];

module.exports = { INITIAL_CARDS, DMAIC_STAGES };
