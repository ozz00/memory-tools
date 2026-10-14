/**
 * 发布策略合规静态哨兵（2026-09-12）
 *
 * 这些检查不对应任何「功能」，全部对应**审核 / 合规红线**——破坏了不会报错，
 * 只会在提审时被驳回，或更糟：上线后才发现「声明与实现不符」。
 * 用静态断言把它们钉死，避免后续迭代无意中拆掉。
 *
 * 覆盖：
 *   1. 关闭分享：miniprogram 内不得出现 onShareAppMessage / onShareTimeline，
 *      且 4 个主页面各自调用 wx.hideShareMenu（本地工具，不做公开传播）
 *   2. 行权渠道：config.js 的 CONTACT_EMAIL 非空且格式合法（隐私指引要求可达）
 *   3. 定位声明：config.js 的 POSITIONING 必须保留「不提供任何学习内容」这句
 *   4. 红线词：wxml 正文 / js 字符串字面量 / json 字段值中不得出现
 *      真题|题库|刷题|押题|中质协（注释不参与审核，故注释不在扫描范围）
 *   5. 发布态开关：data/builtinLocal.js 必须 ENABLED = false 且卡片数组为空
 *   6. 搜索收录：sitemap.json 必须 disallow
 *   7. AppID：project.config.json 必须指向本项目账号
 *   8. 隐私接口：代码用到的隐私接口必须与后台《用户隐私保护指引》声明逐条对应
 *   9. 隐私文案口径：用户可见文案不得出现「不采集/不收集任何…信息」这类
 *      **与后台官方声明用词打架**的绝对否定（后台用的是「收集你选中的文件」）
 *  10. 提审版本号：docs/发布清单.md 标注的提审版本号 必须与 config.js 的 APP_VERSION 一致
 *      （「关于」页版本号来自 config.js，`cli upload -v` 只改后台列表 ⇒ 极易只改一处）
 *
 * 用法：node scripts/regress_publish_policy.cjs
 *
 * 教训（为什么要有第 1 条）：验证「分享是否已关闭」时若用 BSD grep 的
 * `grep "a\|b"` 写法，`\|` 不被识别为「或」⇒ 恒返回「无命中」的**假阴性**。
 * 必须用 `grep -E "a|b"`，或干脆交给本脚本这种带注释剥离的结构化判断。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const APPID = 'wx9e3be49aaf620363';

/* 强红线词：命中即视为漏改。注意「错题本 / 多选题 / 题干」是保留的功能术语，不在列。 */
const FORBIDDEN = ['真题', '题库', '刷题', '押题', '中质协'];
const PAGES_NEED_HIDE = ['pages/anki', 'pages/stats', 'pages/wrong', 'pages/settings'];

/* 已声明进后台《用户隐私保护指引》的接口 → 对应的官方信息类型。
 * 新增隐私接口时必须同时改三处：PRIVACY_MAP、PRIVACY_DECLARED、docs/发布清单.md §3.1。 */
const PRIVACY_DECLARED = {
  chooseMessageFile: '收集你选中的文件',
  chooseMedia: '收集你选中的照片或视频信息',
  setClipboardData: '读取你的剪切板',
};

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  ok    ' + name);
  } else {
    fail++;
    console.log('FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(MP);
const rel = (p) => path.relative(ROOT, p);
const jsFiles = files.filter((p) => p.endsWith('.js'));
const wxmlFiles = files.filter((p) => p.endsWith('.wxml'));
/* json 也要扫：`navigationBarTitleText` 这类字段是**用户可见文案**，却不在
 * wxml/js 范围内 —— 2026-09-12 发现的结构性盲区（app.json 曾遗留「备考宝典」）。
 * json 的 key 不含中文业务词，故可整文件匹配，无需剥离。 */
const jsonFiles = files.filter((p) => p.endsWith('.json'));
const read = (p) => fs.readFileSync(p, 'utf8');

/* 去掉 js 注释后再做「标识符是否还存在」判断。
 * 注释里出现 onShareAppMessage 是合法的（恢复说明），不应判红；
 * 只认代码。`(?<!:)` 避免把字符串里的 https:// 当行注释切掉。 */
function stripJs(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/[^\n]*/g, '');
}

/* ── 1. 关闭分享 ───────────────────────────────────────────── */
const shareHits = jsFiles.filter((p) => /onShareAppMessage|onShareTimeline/.test(stripJs(read(p))));
check('关闭分享：代码中无 onShareAppMessage / onShareTimeline', shareHits.length === 0,
  shareHits.map(rel).join(', '));

const missingHide = PAGES_NEED_HIDE.filter((d) => {
  const p = path.join(MP, d, 'index.js');
  return !fs.existsSync(p) || !/wx\.hideShareMenu\(/.test(read(p));
});
check('关闭分享：' + PAGES_NEED_HIDE.length + ' 个主页面均已调用 wx.hideShareMenu',
  missingHide.length === 0, missingHide.join(', '));

/* ── 2 & 3. config.js 的两条对外声明 ───────────────────────── */
const cfg = read(path.join(MP, 'config.js'));
const emailM = cfg.match(/CONTACT_EMAIL\s*=\s*'([^']*)'/);
const email = emailM ? emailM[1] : '';
check('行权渠道：CONTACT_EMAIL 已填且格式合法',
  /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email), '当前值 = "' + email + '"');
check('定位声明：POSITIONING 保留「不提供任何学习内容」',
  /不提供任何学习内容/.test(cfg));

/* ── 4. 红线词（注释不扫） ─────────────────────────────────── */
const redHits = [];
for (const p of wxmlFiles) {
  const body = read(p).replace(/<!--[\s\S]*?-->/g, '');
  for (const w of FORBIDDEN) if (body.indexOf(w) >= 0) redHits.push(rel(p) + ' → ' + w);
}
for (const p of jsFiles) {
  const lits = read(p).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
  for (const lit of lits) {
    for (const w of FORBIDDEN) if (lit.indexOf(w) >= 0) redHits.push(rel(p) + ' → ' + w);
  }
}
for (const p of jsonFiles) {
  const body = read(p);
  for (const w of FORBIDDEN) if (body.indexOf(w) >= 0) redHits.push(rel(p) + ' → ' + w);
}
check('红线词：用户可见文案（wxml 正文 + js 字符串 + json 字段）零命中', redHits.length === 0,
  redHits.slice(0, 8).join(' ; '));

/* ── 5. 发布态开关 ─────────────────────────────────────────── */
const bl = read(path.join(MP, 'data/builtinLocal.js'));
check('发布态开关：ENABLED = false', /const\s+ENABLED\s*=\s*false\s*;/.test(bl));
check('发布态开关：BUILTIN_CARDS 为空数组', /const\s+BUILTIN_CARDS\s*=\s*\[\s*\]\s*;/.test(bl));

/* ── 6. 搜索收录 ───────────────────────────────────────────── */
try {
  const sm = JSON.parse(read(path.join(MP, 'sitemap.json')));
  const rule = (sm.rules && sm.rules[0]) || {};
  check('搜索收录：sitemap 规则为 disallow', rule.action === 'disallow',
    '当前 action = ' + rule.action);
} catch (e) {
  check('搜索收录：sitemap.json 可解析', false, String(e && e.message));
}

/* ── 7. AppID ──────────────────────────────────────────────── */
try {
  const pc = JSON.parse(read(path.join(MP, 'project.config.json')));
  check('AppID：project.config.json 指向本项目账号', pc.appid === APPID,
    '当前 = ' + pc.appid + '，期望 = ' + APPID);
} catch (e) {
  check('AppID：project.config.json 可解析', false, String(e && e.message));
}

/* ── 8. 隐私接口清单（必须与后台《用户隐私保护指引》逐条对应） ──────
 * 官方对照表：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html
 *
 * 双向判断：
 *   a) 代码用到、但 PRIVACY_DECLARED 里没有 ⇒ 未声明。真机报
 *      `fail api scope is not declared in the privacy agreement`(errno 112)，接口被直接禁用；
 *      若提审时又勾了「未采集隐私」，还会升级为 `fail appid privacy api banned`（权限被回收）。
 *   b) PRIVACY_DECLARED 里有、但代码已不用 ⇒ 申报与实现不符，应从后台声明里删掉。
 *
 * 教训（2026-09-12）：本项目曾先后漏记 `chooseMedia`、`setClipboardData`。
 * 「写方向的 wx.setClipboardData」被官方归入「**读取**你的剪切板」一项 —— 反直觉但必须声明。
 */
const PRIVACY_MAP = {
  getUserInfo: '收集你的昵称、头像', getUserProfile: '收集你的昵称、头像',
  getLocation: '收集你的位置信息', getFuzzyLocation: '收集你的位置信息',
  startLocationUpdate: '收集你的位置信息', startLocationUpdateBackground: '收集你的位置信息',
  choosePoi: '收集你选择的位置信息', chooseLocation: '收集你选择的位置信息',
  chooseAddress: '收集你的地址',
  chooseInvoiceTitle: '收集你的发票信息', chooseInvoice: '收集你的发票信息',
  getWeRunData: '收集你的微信运动步数',
  chooseLicensePlate: '收集你的车牌号',
  chooseImage: '收集你选中的照片或视频信息', chooseMedia: '收集你选中的照片或视频信息',
  chooseVideo: '收集你选中的照片或视频信息',
  chooseMessageFile: '收集你选中的文件',
  startRecord: '访问你的麦克风', joinVoIPChat: '访问你的麦克风',
  createVKSession: '访问你的摄像头',
  openBluetoothAdapter: '访问你的蓝牙', createBLEPeripheralServer: '访问你的蓝牙',
  startBluetoothDevicesDiscovery: '访问你的蓝牙',
  saveImageToPhotosAlbum: '使用你的相册（仅写入）权限', saveVideoToPhotosAlbum: '使用你的相册（仅写入）权限',
  addPhoneContact: '使用你的通讯录（仅写入）权限',
  addPhoneCalendar: '使用你的日历（仅写入）权限', addPhoneRepeatCalendar: '使用你的日历（仅写入）权限',
  startAccelerometer: '调用你的加速传感器', startCompass: '调用你的磁场传感器',
  startDeviceMotionListening: '调用你的方向传感器', startGyroscope: '调用你的陀螺仪传感器',
  setClipboardData: '读取你的剪切板', getClipboardData: '读取你的剪切板',
};

const usedPrivacy = new Set();
for (const p of jsFiles) {
  const re = /\bwx\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(stripJs(read(p))))) if (PRIVACY_MAP[m[1]]) usedPrivacy.add(m[1]);
}
const undeclared = [...usedPrivacy].filter((a) => !PRIVACY_DECLARED[a]);
check('隐私接口：代码用到的 ' + usedPrivacy.size + ' 个接口均已在后台声明',
  undeclared.length === 0,
  undeclared.map((a) => a + '→' + PRIVACY_MAP[a]).join(', '));

const stale = Object.keys(PRIVACY_DECLARED).filter((a) => !usedPrivacy.has(a));
check('隐私接口：已声明的接口在代码中均真实存在（无申报不符）',
  stale.length === 0, stale.join(', '));

/* ── 9. 用户可见文案不得与后台隐私声明「用词打架」 ──────────────────
 * 后台《用户隐私保护指引》用的是官方术语「收集你选中的文件」等；
 * 小程序内文案若写成「不采集任何个人信息」，会被审核机械比对为前后矛盾。
 * 正确口径是强调「不上传、不出设备、开发者接触不到」——
 * 既保住核心承诺，又不与申报用词冲突。
 * 教训：2026-09-12 体验版真机截图里「关于本工具」写的正是「也不采集任何个人信息」，
 * 与本项目已声明的 3 个隐私接口同期存在 ⇒ 已改为「只在你的设备内读取和处理」。 */
const ABSOLUTE_DENIAL = /不(采集|收集|读取)[^。；\n]{0,10}(任何|你的)[^。；\n]{0,10}信息/g;
const denialHits = [];
for (const p of [...jsFiles, ...wxmlFiles, ...jsonFiles]) {
  const m = read(p).match(ABSOLUTE_DENIAL);
  if (m) denialHits.push(rel(p) + ': ' + m.join(' / '));
}
check('隐私文案：无「不采集/不收集任何…信息」这类与后台声明冲突的绝对否定',
  denialHits.length === 0, denialHits.join(' | '));

/* ── 10. 提审版本号三处对齐 ──────────────────────────────────────
 * 「关于」页显示的是 config.js 的 APP_VERSION；`cli upload -v` 只决定后台
 * 「版本管理 → 开发版本」列表里的版本号。两者**互相独立**，极易只改一处。
 * 这里把「文档里标注的提审版本号」与 config.js 配对，漂移立即报红。
 * 2026-09-12 已踩：只改了 `-v 1.0.1` 而没改 config.js ⇒ 关于页仍显示 1.0.0，
 * 被误判为「上传没生效」。 */
const docPath = path.join(ROOT, 'docs', '发布清单.md');
const docSrc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
const docVer = (docSrc.match(/<!--\s*提审版本号:\s*([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] || '';
const cfgVer = (cfg.match(/APP_VERSION\s*=\s*'([^']*)'/) || [])[1] || '';
check('版本号：docs/发布清单.md 有「<!-- 提审版本号: x.y.z -->」标注', !!docVer,
  docVer || '未找到标注');
check('版本号：config.js 的 APP_VERSION 与文档标注一致（文档标注 ' + (docVer || '?') + '）',
  !!docVer && cfgVer === docVer, 'config.js = ' + (cfgVer || '(空)'));

console.log('\n发布策略合规：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
