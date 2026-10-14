/**
 * 回归：内置题库发布开关（builtinLocal.js + defaultCards.js 合并逻辑）
 *
 * 用法：node scripts/regress_builtin_switch.cjs
 * 说明：脚本会临时改写 miniprogram/data/builtinLocal.js 并 finally 恢复，
 *       require 缓存按用例清理，避免串扰。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'miniprogram/data/builtinLocal.js');
const SRC_DEFAULT = path.join(ROOT, 'miniprogram/data/defaultCards.js');
const backup = fs.readFileSync(TARGET, 'utf8');

const builtinsOf = (arr) => (arr || []).filter((c) => String(c.id).indexOf('builtin-') === 0);

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' => ' + JSON.stringify(extra)); }
}

/**
 * 写入指定内容并加载 defaultCards。
 * 注意：项目 package.json 为 type:module，Node 下 require('.js') 会被当 ESM 解析，
 * 因此把 builtinLocal 内容落到临时 .cjs 再改写 require 路径（小程序侧不受影响）。
 * @param {string|null} content 传 null 表示「文件缺失」场景
 */
function loadWith(content) {
  const tmpDep = path.join(os.tmpdir(), 'caq_builtin_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.cjs');
  if (content !== null) fs.writeFileSync(tmpDep, content, 'utf8');

  // sampleCards.js 同样要 .cjs 化（type:module 下无法直接 require 项目内 .js）
  const tmpSample = path.join(os.tmpdir(), 'caq_sample_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.cjs');
  fs.copyFileSync(path.join(ROOT, 'miniprogram/data/sampleCards.js'), tmpSample);

  const tmp = path.join(os.tmpdir(), 'caq_default_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.cjs');
  const src = fs.readFileSync(SRC_DEFAULT, 'utf8')
    .replace(/require\('\.\/builtinLocal\.js'\)/, "require('" + tmpDep.replace(/\\/g, '/') + "')")
    .replace(/require\('\.\/sampleCards\.js'\)/, "require('" + tmpSample.replace(/\\/g, '/') + "')");
  fs.writeFileSync(tmp, src, 'utf8');

  let mod = null;
  try {
    mod = require(tmp);
  } finally {
    [tmp, tmpSample].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
    try { if (content !== null) fs.unlinkSync(tmpDep); } catch (e) {}
  }
  return mod;
}

try {
  // ── 用例 1：发布模式（ENABLED:false + 空数组）──
  const m1 = loadWith('const ENABLED = false;\nconst BUILTIN_CARDS = [];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  assert('1 发布模式无内置卡（仅保留示例卡）', builtinsOf(m1.INITIAL_CARDS).length === 0, builtinsOf(m1.INITIAL_CARDS).length);
  assert('1 发布模式示例卡仍在', m1.INITIAL_CARDS.length > 0 && m1.INITIAL_CARDS.every((c) => String(c.id).indexOf('sample-') === 0), m1.INITIAL_CARDS.length);
  assert('1 DMAIC_STAGES 保留', Array.isArray(m1.DMAIC_STAGES) && m1.DMAIC_STAGES.length >= 6, m1.DMAIC_STAGES && m1.DMAIC_STAGES.length);

  // ── 用例 2：本地自用模式（ENABLED:true + 2 张卡）──
  const m2 = loadWith(
    'const ENABLED = true;\n' +
    'const BUILTIN_CARDS = [\n' +
    '  { id:"builtin-0001", deck:"测试题集", front:"题干1", back:"答案：A", options:["A. x","B. y"], correctAnswer:"A", cardType:"single_choice", tags:["内置"], stage:"measure", interval:0, repetitions:0, easeFactor:2.5, nextReviewDate:0, state:"new" },\n' +
    '  { id:"builtin-0002", deck:"测试题集", front:"题干2", back:"答案：B", options:["A. x","B. y"], correctAnswer:"B", cardType:"single_choice", tags:["内置"], stage:"measure", interval:0, repetitions:0, easeFactor:2.5, nextReviewDate:0, state:"new" }\n' +
    '];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n'
  );
  const b2 = builtinsOf(m2.INITIAL_CARDS);
  assert('2 自用模式加载 2 张内置卡', b2.length === 2, b2.length);
  assert('2 示例卡同时保留（24 张）', m2.INITIAL_CARDS.length === b2.length + 24, m2.INITIAL_CARDS.length);
  assert('2 内置卡 id 为 builtin- 前缀（不会被 removeBuiltIns 清除）',
    b2.every((c) => String(c.id).indexOf('builtin-') === 0), b2.map((c) => c.id));
  assert('2 保留 deck', b2[0].deck === '测试题集', b2[0] && b2[0].deck);

  // ── 用例 3：开关优先于内容（ENABLED:false 但有卡 → 仍为空）──
  const m3 = loadWith('const ENABLED = false;\nconst BUILTIN_CARDS = [{ id:"builtin-0001", front:"不该出现" }];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  assert('3 ENABLED:false 时内容被忽略', builtinsOf(m3.INITIAL_CARDS).length === 0, builtinsOf(m3.INITIAL_CARDS).length);

  // ── 用例 4：旧格式兼容（无 ENABLED 字段，直接导出数组）──
  const m4 = loadWith('module.exports = { BUILTIN_CARDS: [{ id:"builtin-0001", front:"兼容" }] };\n');
  assert('4 缺 ENABLED 字段时默认启用', builtinsOf(m4.INITIAL_CARDS).length === 1, builtinsOf(m4.INITIAL_CARDS).length);

  // ── 用例 5：依赖文件缺失 → 不崩溃，空库启动 ──
  const m5 = loadWith(null);
  assert('5 依赖缺失时不抛异常（回退为仅示例卡）',
    m5 && Array.isArray(m5.INITIAL_CARDS) && builtinsOf(m5.INITIAL_CARDS).length === 0
      && m5.INITIAL_CARDS.length > 0 && m5.DMAIC_STAGES.length >= 6, m5 && m5.INITIAL_CARDS && m5.INITIAL_CARDS.length);

  console.log('\n内置题库开关回归：通过 ' + pass + ' / 失败 ' + fail);
} finally {
  fs.writeFileSync(TARGET, backup, 'utf8');
  console.log('（已恢复 builtinLocal.js 原内容）');
}

process.exit(fail ? 1 : 0);
