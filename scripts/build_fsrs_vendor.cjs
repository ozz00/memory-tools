#!/usr/bin/env node
/**
 * 把 ts-fsrs 预打包成小程序可直接 require 的单文件。
 *
 * 为什么不走微信开发者工具的「构建 npm」：
 *   开发者工具 packJs() 解析入口时写死了
 *     e.endsWith(".js") || e.endsWith(".json") || (e += ".js")
 *   而 ts-fsrs 的 main 是 "dist/index.cjs" —— .cjs 不被识别，被改写成
 *   "dist/index.cjs.js" 后入口不存在，该包被静默跳过，最终报
 *   __NO_NODE_MODULES__（错误信息完全误导）。
 *   同时该打包器只读 main、忽略 exports 字段，改 exports 无效。
 *
 * 因此改为预打包：产物是一个普通 CommonJS 文件，与项目里 sm2.js 形态一致，
 * 不引入 package.json、不引入 miniprogram_npm/、不改 project.config.json，
 * 发布包结构完全不变。
 *
 * 用法：
 *   node scripts/build_fsrs_vendor.cjs            # 构建并比对哈希
 *   node scripts/build_fsrs_vendor.cjs --check    # 只校验产物是否为最新（供 run_all 使用）
 *
 * 前置：根目录已 npm i ts-fsrs@<pin>（版本见下 TS_FSRS_VERSION）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TS_FSRS_VERSION = '5.4.2'; // 与 package.json 的 devDependencies 保持一致
const SRC_ENTRY = path.join(ROOT, 'node_modules/ts-fsrs/dist/index.mjs');
const OUT_FILE = path.join(ROOT, 'miniprogram/utils/fsrs.js');
const HASH_FILE = path.join(ROOT, 'scripts/.fsrs_vendor.sha256');

const BUILD_ARGS = [
  SRC_ENTRY,
  '--bundle',
  '--minify',
  '--format=cjs',
  '--platform=neutral',
  // 不用 es5：esbuild 明确不支持把 class 降级到 ES5。
  // 本项目 libVersion >= 3.5.0，原生支持 ES2017。
  '--target=es2017',
  '--outfile=' + OUT_FILE,
  '--log-level=warning'
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function esbuildBin() {
  const bin = path.join(ROOT, 'node_modules/.bin/esbuild');
  if (!fs.existsSync(bin)) {
    console.error('找不到 esbuild：' + bin + '\n请先在项目根目录执行 npm install。');
    process.exit(2);
  }
  return bin;
}

const checkOnly = process.argv.includes('--check');

// --check 只比对产物哈希，不需要 ts-fsrs 源码 —— 因此放在前置依赖检查之前，
// 这样 run_all.sh / CI 未安装 devDependencies 时也能校验产物未被手改。
if (checkOnly) {
  if (!fs.existsSync(OUT_FILE) || !fs.existsSync(HASH_FILE)) {
    console.error('FAIL  fsrs.js 产物或哈希记录缺失，请运行 node scripts/build_fsrs_vendor.cjs');
    process.exit(1);
  }
  const want = fs.readFileSync(HASH_FILE, 'utf8').trim();
  const got = sha256(OUT_FILE);
  if (want !== got) {
    console.error('FAIL  fsrs.js 与记录的哈希不一致（被人手改过？）');
    console.error('      记录=' + want.slice(0, 16) + ' 实际=' + got.slice(0, 16));
    process.exit(1);
  }
  console.log('ok    fsrs.js 哈希与记录一致 (' + got.slice(0, 16) + ')');
  process.exit(0);
}

if (!fs.existsSync(SRC_ENTRY)) {
  console.error('找不到 ts-fsrs 源码入口：' + SRC_ENTRY
    + '\n请执行：npm i -D ts-fsrs@' + TS_FSRS_VERSION);
  process.exit(2);
}

const installed = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules/ts-fsrs/package.json'), 'utf8')
).version;
if (installed !== TS_FSRS_VERSION) {
  console.error('ts-fsrs 版本不匹配：已安装 ' + installed + '，期望 ' + TS_FSRS_VERSION
    + '\n请执行：npm i -D ts-fsrs@' + TS_FSRS_VERSION);
  process.exit(2);
}

execFileSync(esbuildBin(), BUILD_ARGS, { stdio: 'inherit', cwd: ROOT });

const size = fs.statSync(OUT_FILE).size;
const gz = require('zlib').gzipSync(fs.readFileSync(OUT_FILE)).length;
const hash = sha256(OUT_FILE);
fs.writeFileSync(HASH_FILE, hash + '\n');

console.log('ok    已生成 ' + path.relative(ROOT, OUT_FILE));
console.log('      源码版本 ts-fsrs@' + installed + ' (FSRS-6.0)');
console.log('      体积 ' + size + ' 字节 / gzip ' + gz + ' 字节');
console.log('      sha256 ' + hash.slice(0, 16));
console.log('');
console.log('自检：');
// 注意：不能用裸 require(OUT_FILE) —— 根 package.json 是 type:module，
// Node 会把项目内的 .js 当 ESM 解析（小程序侧无此问题），必须复制成 .cjs 再加载。
const os = require('os');
const SELF_CHECK = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caq_fsrs_')), 'fsrs.cjs');
fs.copyFileSync(OUT_FILE, SELF_CHECK);

execFileSync(process.execPath, ['-e', `
  const fs = require('fs');
  const F = require(${JSON.stringify(SELF_CHECK)});
  const need = ['fsrs','createEmptyCard','generatorParameters','Rating','State','default_w'];
  const miss = need.filter(k => !(k in F));
  if (miss.length) { console.error('  FAIL 缺少导出: ' + miss.join(',')); process.exit(1); }
  if (!Array.isArray(F.default_w) || F.default_w.length !== 21) {
    console.error('  FAIL 权重数量异常: ' + (F.default_w || []).length); process.exit(1);
  }
  // 产物必须自包含：有任何外部 require 都说明打包不完整（小程序里会直接崩）
  const raw = fs.readFileSync(${JSON.stringify(OUT_FILE)}, 'utf8');
  const ext = (raw.match(/require\\(\\s*['"][^'"]+['"]\\s*\\)/g) || []);
  if (ext.length) { console.error('  FAIL 产物含外部 require: ' + ext.slice(0,3).join(' ')); process.exit(1); }
  // 关掉短时学习步再断言：默认 enable_short_term=true 时首次「良好」走 1m/10m
  // 学习步，scheduled_days 为 0（分钟级），拿不到"天数间隔"这个能一眼看懂的指标。
  const f = F.fsrs(F.generatorParameters({ enable_fuzz: false, enable_short_term: false }));
  const c = f.next(F.createEmptyCard(new Date(2026,0,1)), new Date(2026,0,2), F.Rating.Good).card;
  if (!(c.stability > 0) || !(c.difficulty > 0) || !(c.scheduled_days >= 1)) {
    console.error('  FAIL 排期结果异常'); process.exit(1);
  }
  console.log('  ok    ' + Object.keys(F).length + ' 导出 / 21 权重 / 零外部 require / 排期 S='
    + c.stability.toFixed(2) + ' D=' + c.difficulty.toFixed(2)
    + ' 间隔=' + c.scheduled_days + '天（enable_short_term=false）');
`], { stdio: 'inherit' });
