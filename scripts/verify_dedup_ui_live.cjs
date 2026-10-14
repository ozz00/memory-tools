/**
 * 去重确认弹窗的 UI 验证（需开发者工具处于自动化模式）
 *
 * 目的：regress / verify 脚本验的都是「判定逻辑」与「落库结果」，
 * 但用户真正看到的是 admin 页那个「发现重复题目」弹窗 —— 文案、按钮、
 * 以及点了「跳过重复」之后 toast 报的对不对，只有跑起页面才知道。
 *
 * 走的是真实页面方法（page.confirmImport），不是模拟：
 * 先把解析结果灌进页面 data，再触发导入，拦截 wx.showModal 记录内容并截图。
 *
 * 不纳入 run_all.sh（需要 IDE 自动化端口）。
 */
const automator = require('miniprogram-automator');
const path = require('path');

const PORT = process.env.WS_PORT || process.env.AUTO_PORT || 9440;
const ROOT = '/Users/jackyzhao/Documents/Myapp/CAQ-tester/CAQ--main';
const OUT = path.join(ROOT, '.workbuddy/screenshots');

const { makeCardIO } = require('./_liveenv.cjs');

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
};

const TOPICS = ['过程能力指数 Cpk', '测量系统分析 GR&R', '缺陷率 DPMO', '控制图判异准则',
  '试验设计 DOE', '失效模式 FMEA', '统计过程控制 SPC', '假设检验第一类错误'];

/** 造一份 Anki TXT（制表符分隔，带 HTML）—— 与用户真实导出的格式一致 */
function makeTxt(n, tag) {
  const lines = ['#separator:tab', '#html:true', '#columns:front back tags'];
  for (let i = 1; i <= n; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const v = Math.floor(i / TOPICS.length);
    const stem = '关于' + topic + '的应用，下列说法不正确的是（）' + (v ? '（变体 ' + v + '）' : '');
    const front = '<div>（单选）' + i + '．' + stem + '</div>'
      + '<div>A. 需先确认测量系统可靠' + tag + i + '</div><div>B. 只看固有波动' + tag + i + '</div>'
      + '<div>C. 与规格限无关' + tag + i + '</div><div>D. 仅用于计数型数据' + tag + i + '</div>';
    const back = '<b>答案：A</b><br/>解析：测量系统需先做 GR&R，否则后续分析不可信。';
    lines.push([front, back, 'qNo:' + i + ' type:single_choice stage:measure'].join('\t'));
  }
  return lines.join('\n') + '\n';
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const io = makeCardIO(mp);

  const backupCards = await io.readCards();
  console.log('备份：卡片 ' + backupCards.length + ' 张');

  try {
    // 注意：automator 的 reLaunch 只认**字符串**参数；传 {url} 会报 Uncaught [object Object]
    await mp.reLaunch('/pages/admin/index');
    await new Promise((r) => setTimeout(r, 1500));

    /* ── 1. 先导入一批，作为「库中已有」的基线 ── */
    console.log('\n── 1. 基线：先导入 30 张 ──');
    const txt = makeTxt(30, 'A');
    const baseInfo = await mp.evaluate((t) => {
      const store = require('utils/store.js');
      const importer = require('utils/importer.js');
      const r = importer.parseText(t);
      if (!r.success) return { ok: false, msg: r.message };
      const cards = r.cards.map((c) => Object.assign({}, c, { deck: 'E2E-UI题集' }));
      store.importCards(cards, 'append');
      const rep = store.getLastImportReport();
      return { ok: true, parsed: r.cards.length, added: rep.added, skipped: rep.skippedDuplicates };
    }, txt);
    check('1.1 解析成功', baseInfo.ok === true, baseInfo.msg || (baseInfo.parsed + ' 张'));
    check('1.2 基线 30 张入库', baseInfo.added === 30 && baseInfo.skipped === 0,
      'added=' + baseInfo.added + ' skipped=' + baseInfo.skipped);

    /* ── 2. 走真实页面方法触发导入，拦截弹窗 ── */
    console.log('\n── 2. 重新上传同一份 ⇒ 页面应弹「发现重复卡片」 ──');
    const shot1 = path.join(OUT, 'dedup_modal_confirm.png');
    const ui = await mp.evaluate((t) => {
      const store = require('utils/store.js');
      const importer = require('utils/importer.js');
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];

      const r = importer.parseText(t);
      if (!r.success) return { ok: false, msg: r.message };
      // 卡片自带 deck ⇒ needName=false，confirmImport 会直接进去重闸门。
      // 关键：必须把**打好 deck 的**结果放进 parseResult —— needName 判的是 r.cards，
      // 放原始的（无 deck）会先弹「确认题集名称」，捕获到的就不是去重弹窗了。
      const cards = r.cards.map((c) => Object.assign({}, c, { deck: 'E2E-UI题集' }));
      const parsed = Object.assign({}, r, { cards: cards, preview: [] });

      const captured = { modal: null, toast: null };
      const origModal = wx.showModal;
      const origToast = wx.showToast;
      wx.showModal = function (o) {
        captured.modal = { title: o.title, content: o.content, confirmText: o.confirmText, cancelText: o.cancelText };
        return origModal(o); // 真弹出来，好截图
      };
      wx.showToast = function (o) { captured.toast = { title: o.title, icon: o.icon }; return origToast(o); };

      page.setData({ parseResult: parsed, rawText: t, deckName: 'E2E-UI题集' });
      page.confirmImport();

      // 同步恢复（confirmImport 里的 showModal 是同步调用的，此时已捕获）
      wx.showModal = origModal;
      wx.showToast = origToast;
      return { ok: true, modal: captured.modal, toast: captured.toast, route: page.route };
    }, txt);

    check('2.1 当前在管理页', ui.route === 'pages/admin/index', ui.route);
    check('2.2 弹出了确认框', !!(ui.modal && ui.modal.title), ui.modal && ui.modal.title);
    check('2.3 标题是「发现重复卡片」', ui.modal && ui.modal.title === '发现重复卡片', ui.modal && ui.modal.title);
    check('2.4 文案报出 30 张与库中重复', ui.modal && /30\s*张与库中已有题目相同/.test(ui.modal.content),
      ui.modal && ui.modal.content);
    check('2.5 默认确认 = 跳过重复（安全侧）', ui.modal && ui.modal.confirmText === '跳过重复', ui.modal && ui.modal.confirmText);
    check('2.6 取消 = 仍然导入（逃生通道）', ui.modal && ui.modal.cancelText === '仍然导入', ui.modal && ui.modal.cancelText);

    await new Promise((r) => setTimeout(r, 600));
    await mp.screenshot({ path: shot1 });
    console.log('      截图 => ' + shot1);

    /* ── 3. 点「跳过重复」后的 toast ── */
    console.log('\n── 3. 点「跳过重复」后应提示「全部重复，未导入」 ──');
    const after = await mp.evaluate((t) => {
      const importer = require('utils/importer.js');
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const r = importer.parseText(t);
      const cards = r.cards.map((c) => Object.assign({}, c, { deck: 'E2E-UI题集' }));
      const parsed = Object.assign({}, r, { cards: cards, preview: [] });

      const captured = { toast: null };
      const origToast = wx.showToast;
      const origModal = wx.showModal;
      // 模拟用户点「跳过重复」：直接让 showModal 回 confirm:true
      wx.showModal = function (o) { if (o.success) o.success({ confirm: true, cancel: false }); };
      wx.showToast = function (o) { captured.toast = { title: o.title, icon: o.icon }; return origToast(o); };

      page.setData({ parseResult: parsed, rawText: t, deckName: 'E2E-UI题集' });
      page.confirmImport();

      wx.showModal = origModal;
      wx.showToast = origToast;
      return { toast: captured.toast, cards: require('utils/store.js').getCards().length };
    }, txt);

    check('3.1 有 toast 提示', !!(after.toast && after.toast.title), after.toast && after.toast.title);
    check('3.2 文案说明「全部重复，未导入」', after.toast && /全部重复/.test(after.toast.title), after.toast && after.toast.title);
    check('3.3 用 icon:none（success 只显示 7 字会被截断）', after.toast && after.toast.icon === 'none', after.toast && after.toast.icon);

    /* ── 4. 混合批次：一半新一半旧 ── */
    console.log('\n── 4. 一半新一半旧 ⇒ 提示「已导入 N 张，跳过 N 张重复」 ──');
    const mixed = makeTxt(30, 'A') + makeTxt(30, 'B').split('\n').slice(3).join('\n');
    const mix = await mp.evaluate((t) => {
      const importer = require('utils/importer.js');
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const r = importer.parseText(t);
      const cards = r.cards.map((c) => Object.assign({}, c, { deck: 'E2E-UI题集' }));
      const parsed = Object.assign({}, r, { cards: cards, preview: [] });

      const captured = { modal: null, toast: null };
      const origToast = wx.showToast;
      const origModal = wx.showModal;
      wx.showModal = function (o) {
        captured.modal = { title: o.title, content: o.content };
        if (o.success) o.success({ confirm: true, cancel: false });
      };
      wx.showToast = function (o) { captured.toast = { title: o.title, icon: o.icon }; return origToast(o); };

      page.setData({ parseResult: parsed, rawText: t, deckName: 'E2E-UI题集' });
      page.confirmImport();
      wx.showModal = origModal;
      wx.showToast = origToast;
      return { parsed: r.cards.length, modal: captured.modal, toast: captured.toast };
    }, mixed);

    check('4.1 混合批解析出 60 张', mix.parsed === 60, mix.parsed);
    check('4.2 弹窗报 30 张重复', mix.modal && /30\s*张与库中已有题目相同/.test(mix.modal.content), mix.modal && mix.modal.content);
    check('4.3 toast 报「已导入 30 张，跳过 30 张重复」',
      mix.toast && /已导入\s*30\s*张/.test(mix.toast.title) && /跳过\s*30\s*张重复/.test(mix.toast.title),
      mix.toast && mix.toast.title);

    await new Promise((r) => setTimeout(r, 1200));
    const shot2 = path.join(OUT, 'dedup_toast_mixed.png');
    await mp.screenshot({ path: shot2 });
    console.log('      截图 => ' + shot2);

  } finally {
    console.log('\n── 还原题库 ──');
    if (backupCards.length) await io.writeCards(backupCards);
    const after = await io.readCards();
    console.log('还原后：卡片 ' + after.length + ' 张（备份 ' + backupCards.length + ' 张）');
    await mp.disconnect();
  }

  console.log('\n去重弹窗 UI（真机）：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('运行异常：', e && e.stack || e);
  process.exit(1);
});
