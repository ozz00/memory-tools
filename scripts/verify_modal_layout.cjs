#!/usr/bin/env node
/**
 * 设置页弹窗布局回归（真机几何 + 可滚动性）
 *
 * 背景：iPhone 上弹窗底部按钮「好的，知道了」曾被压扁并溢出到自定义 tabBar 区域。
 * 根因是 scroll-view 不参与 flex 收缩，而卡片 max-height:85vh 小于「固定头部 + 正文
 * min(70vh) + 按钮」的最小需求，收缩压力全落在按钮上。修复后此处做几何回归。
 *
 * 前置条件：
 *   1) 开发者工具以自动化模式启动（会占用 IDE，其他操作需先关掉）：
 *      /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *        --project "$(pwd)/miniprogram" --auto-port 9420
 *   2) 安装依赖：npm i miniprogram-automator（本脚本会依次尝试项目、托管工作区）
 * 运行：
 *   node scripts/verify_modal_layout.cjs
 * 断言：
 *   - 弹窗按钮高度 ≈ 基准按钮高度（未被 flex 压扁）
 *   - 卡片底边不越过遮罩内容盒（不被自定义 tabBar 遮挡）
 *   - 长文弹窗可用 scroll-into-view 把底部按钮滚进可视区（内容可达）
 *   - 点击按钮能关闭弹窗
 */
const path = require('path');

const WS = process.env.WB_AUTO_WS || 'ws://127.0.0.1:9420';

function loadAutomator() {
  const candidates = [
    'miniprogram-automator',
    path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/miniprogram-automator'),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      /* try next */
    }
  }
  console.error('未找到 miniprogram-automator，请先执行：npm i miniprogram-automator');
  process.exit(2);
}

const automator = loadAutomator();
const px = (v) => parseFloat(String(v).replace('px', ''));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const sys = await mp.systemInfo();
  const W = sys.windowWidth;
  const H = sys.windowHeight;
  const safeBottom = sys.screenHeight - (sys.safeArea ? sys.safeArea.bottom : sys.screenHeight);
  const rpx = (v) => (v * W) / 750;

  // 与 index.wxss 保持一致：遮罩左右/上下内边距、自定义 tabBar 高度
  const maskPadBottom = rpx(120) + safeBottom;
  const tabBarTop = H - (rpx(76) + safeBottom);
  const contentBottom = H - maskPadBottom;

  console.log('窗口 %sx%s  底部安全区 %s  遮罩内容盒底边 %s  tabBar 顶边 %s',
    W, H, safeBottom, contentBottom.toFixed(1), tabBarTop.toFixed(1));

  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    console.log('  %s %s  %s', ok ? 'PASS' : 'FAIL', name, detail || '');
  };
  const box = async (el) => {
    const s = await el.size();
    const o = await el.offset();
    const y = o.top === undefined ? o.y : o.top;
    return { y, h: px(s.height), bottom: y + px(s.height) };
  };

  let page;
  const openModal = async (kw) => {
    page = await mp.reLaunch('/pages/settings/index');
    await page.waitFor(1200);
    const rows = await page.$$('.row');
    let hit = false;
    for (const r of rows) {
      if ((await r.text()).includes(kw)) { await r.tap(); hit = true; break; }
    }
    // 找不到行必须**显式报错**，否则后续断言会以「取到 null」的形式崩在别处，
    // 报错信息完全指不到根因（曾经因为一处文案改名静默失效很久）。
    if (!hit) {
      throw new Error('设置页找不到含「' + kw + '」的行 —— 该行文案可能已改名，'
        + '请同步更新本脚本的关键词（与 index.wxml 保持一致）');
    }
    await page.waitFor(900);
  };

  // 基准：数量弹窗（内容短、必然不压缩）里的按钮高度
  // ⚠️ 关键词必须与 index.wxml 的行文案一致。该行曾叫「每日学习计划」，
  //    改名成「单批卡片数」后本脚本一度静默失效（找不到行 → 基准取空 → 全挂）。
  await openModal('单批卡片数');
  const refEl = (await page.$$('.picker-btn'))[0];
  if (!refEl) {
    console.error('基准弹窗未打开：设置页里找不到「单批卡片数」这一行，'
      + '或该弹窗没有 .picker-btn 按钮。请核对 scripts/verify_modal_layout.cjs 里的关键词 '
      + '与 miniprogram/pages/settings/index.wxml 的行文案是否仍然一致。');
    process.exit(3);
  }
  const refBtn = await box(refEl);
  console.log('基准按钮高度 = %s px\n', refBtn.h.toFixed(1));

  for (const modal of [
    { kw: 'SM-2', name: 'SM-2 记忆算法机制（长文）' },
    { kw: '艾宾浩斯', name: '艾宾浩斯遗忘曲线（中长）' },
    { kw: '使用说明', name: '使用说明（短文）' },
    { kw: '关于', name: '关于本工具（短文／对外信息）' },
  ]) {
    await openModal(modal.kw);
    const card = await page.$('.modal-card');
    const btn = (await card.$$('button'))[0];
    const cb = await box(card);
    const bb = await box(btn);
    console.log('--- %s ---', modal.name);
    console.log('  卡片 y=%s h=%s bottom=%s | 按钮 h=%s', cb.y.toFixed(1), cb.h.toFixed(1), cb.bottom.toFixed(1), bb.h.toFixed(1));

    check('按钮高度未被压扁', bb.h > refBtn.h * 0.9, `h=${bb.h.toFixed(1)} 基准=${refBtn.h.toFixed(1)}`);
    check('卡片底边未越过遮罩内容盒（不被 tabBar 遮挡）', cb.bottom <= contentBottom + 1,
      `card.bottom=${cb.bottom.toFixed(1)} 上限=${contentBottom.toFixed(1)}`);
    check('卡片底边在自定义 tabBar 上方', cb.bottom <= tabBarTop + 1,
      `card.bottom=${cb.bottom.toFixed(1)} tabBar.top=${tabBarTop.toFixed(1)}`);

    // 内容是否真的超出卡片：超出则必须能滚动到按钮，没超出则按钮应直接在可视区
    const contentH = px(await card.scrollHeight());
    const needScroll = contentH > cb.h + 5;
    if (needScroll) {
      const before = bb.y;
      await page.setData({ scrollAnchor: 'modal-footer-anchor' });
      await page.waitFor(1400);
      const cardScrolled = await page.$('.modal-card');
      const after = await box((await cardScrolled.$$('button'))[0]);
      const moved = before - after.y;
      check('内容超出→卡片可滚动（底部按钮可达）', moved > 50,
        `内容 ${contentH.toFixed(0)}px > 卡片 ${cb.h.toFixed(0)}px，位移=${moved.toFixed(1)}px`);
      check('滚到底后按钮完整落在卡片可视区内', after.bottom <= cb.bottom + 1 && after.y >= cb.y - 1,
        `btn=${after.y.toFixed(1)}~${after.bottom.toFixed(1)} 卡片可视区=${cb.y.toFixed(1)}~${cb.bottom.toFixed(1)}`);
    } else {
      check('内容未超出→按钮直接在可视区', bb.bottom <= cb.bottom + 1 && bb.y >= cb.y - 1,
        `内容 ${contentH.toFixed(0)}px ≤ 卡片 ${cb.h.toFixed(0)}px`);
    }

    const liveCard = await page.$('.modal-card');
    await (await liveCard.$$('button'))[0].tap();
    await page.waitFor(600);
    check('点击按钮可关闭弹窗', (await page.$('.modal-card')) === null);
  }

  // 「关于」是对外信息披露页，内容比几何更要紧：版本号 / 定位声明 / 联系方式必须齐。
  // 这三项是提审与《用户隐私保护指引》的支撑材料，缺一项审核就可能被打回。
  const fs = require('fs');
  const os = require('os');
  // ⚠️ 项目 package.json 是 "type": "module"，直接 require 一个 .js 会被当成 ESM
  //    （报 "module is not defined in ES module scope"）。拷成 .cjs 再 require 即可。
  const cfgTmp = path.join(os.tmpdir(), 'caq_cfg_' + process.pid + '.cjs');
  fs.writeFileSync(cfgTmp,
    fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'config.js'), 'utf8'), 'utf8');
  const cfg = require(cfgTmp);
  await openModal('关于');
  const aboutCard = await page.$('.modal-card');
  const aboutText = await aboutCard.text();
  console.log('--- 关于本工具（对外信息）---');
  console.log('  版本 %s | 公众号 %s | 邮箱 %s',
    cfg.APP_VERSION, cfg.CONTACT_MP || '(未设)', cfg.CONTACT_EMAIL || '(未设)');
  check('关于页展示版本号', aboutText.indexOf(cfg.APP_VERSION) >= 0, cfg.APP_VERSION);
  check('关于页含定位声明（不提供学习内容）', aboutText.indexOf('不提供任何学习内容') >= 0, null);
  check('关于页含数据存放说明（仅本机）', aboutText.indexOf('本机') >= 0, null);
  check('关于页含联系渠道（公众号或邮箱至少一项）',
    (!!cfg.CONTACT_MP && aboutText.indexOf(cfg.CONTACT_MP) >= 0)
    || (!!cfg.CONTACT_EMAIL && aboutText.indexOf(cfg.CONTACT_EMAIL) >= 0), null);

  const shotDir = path.join(__dirname, '..', '.workbuddy', 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  await mp.screenshot({ path: path.join(shotDir, 'about_modal.png') });
  const aboutBtn = (await aboutCard.$$('button'))[0];
  const ab = await box(aboutBtn);
  const acb = await box(aboutCard);
  check('关于弹窗按钮未被压扁（内容自适应高度）', ab.h > refBtn.h * 0.9,
    `h=${ab.h.toFixed(1)} 基准=${refBtn.h.toFixed(1)}`);
  check('关于弹窗底边未越过遮罩内容盒', acb.bottom <= contentBottom + 1,
    `card.bottom=${acb.bottom.toFixed(1)} 上限=${contentBottom.toFixed(1)}`);
  await aboutBtn.tap();
  await page.waitFor(600);
  check('点击按钮可关闭关于弹窗', (await page.$('.modal-card')) === null);

  const pass = results.filter(Boolean).length;
  console.log('\n合计：通过 %d / 失败 %d', pass, results.length - pass);
  await mp.disconnect();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('ERROR', e && e.message ? e.message : e);
  process.exit(2);
});
