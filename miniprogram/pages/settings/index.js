const store = require('../../utils/store.js');
const CONFIG = require('../../config.js');

/* 时间戳 → 'MM-DD HH:mm'（当年省略年份） */
function fmtTime(ts) {
  if (!ts) return '从未';
  const d = new Date(ts);
  const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    dark: false,
    activeSubModal: null,  // 'sm2' | 'ebbinghaus' | 'guide' | 'about' | null

    /* 关于（对外信息，来源 config.js，不要在这里再写一份） */
    appVersion: CONFIG.APP_VERSION,
    contactEmail: CONFIG.CONTACT_EMAIL,
    contactMp: CONFIG.CONTACT_MP,
    positioning: CONFIG.POSITIONING,
    cardsCount: 0,
    studyCount: 30,        // 每批卡片数（设置默认值）
    showCountModal: false, // 是否显示数量设置弹层
    countPick: 30,         // 弹层中选中的预设值
    countPickCustom: false,// 弹层是否处于「自定义」
    countCustomVal: '',    // 弹层自定义输入值

    /* 每日任务配额与备考覆盖率（2026-09-10 新增） */
    newPerDay: 20,         // 每日新卡上限（决定首轮天数）
    reviewPerDay: 0,       // 每日到期复习上限（0 = 不限）
    examDate: '',          // 考试日期 'YYYY-MM-DD'；空 = 未设置
    examDays: 0,           // 距考试天数（0 = 未设置）
    examPlan: null,        // 覆盖率预警数据（store.getExamPlan）
    showQuotaModal: false, // 配额设置弹层
    quotaHint: '',         // 弹层内实时反馈文案
    quotaWarn: false,      // 反馈是否为「来不及」预警
    todayStr: '',          // date picker 的可选起始日

    /* 间隔上限（2026-09-10 新增）：对 SM-2 生效的「考前压缩」旋钮 */
    maxIntervalDays: 90,   // 当前上限（天）
    intervalIndex: 1,      // picker 选中项下标（对应 intervalValues）
    intervalValues: [60, 90, 180, 365],
    intervalLabels: [
      '60 天 · 冲刺（考前 2 个月全覆盖，复习量 +11%）',
      '90 天 · 推荐（默认，覆盖考前 3 个月，复习量 +1%）',
      '180 天 · 宽松（覆盖减半，复习量几乎不增）',
      '365 天 · 不压缩（SM-2 原生上限，考前可能长时间不复习）'
    ]
  },

  onShow() {
    /* 本地工具：关闭「转发」与「分享到朋友圈」入口（与「备忘录」类目释义一致） */
    wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    const s = store.getSettings();
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
    const ivs = this.data.intervalValues;
    let idx = ivs.indexOf(Number(s.maxIntervalDays));
    if (idx < 0) idx = ivs.indexOf(90);
    this.setData({
      dark: s.dark,
      studyCount: s.studyCount || 30,
      cardsCount: store.getCards().length,
      newPerDay: s.newPerDay,
      reviewPerDay: s.reviewPerDay,
      examDate: s.examDate,
      examDays: store.daysToExam(s.examDate) || 0,
      examPlan: store.getExamPlan(),
      maxIntervalDays: s.maxIntervalDays,
      intervalIndex: idx < 0 ? 1 : idx,
      todayStr: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    });
    store.applyNavBar(s.dark);
  },

  toggleDark() {
    const next = !this.data.dark;
    this.setData({ dark: next });
    const s = store.setSettings({ dark: next });
    store.applyNavBar(s.dark);
    // 立即同步自定义底部导航条的深色样式
    if (typeof this.getTabBar === 'function') {
      const bar = this.getTabBar();
      if (bar && bar.sync) bar.sync();
    }
  },

  openModal(e) { this.setData({ activeSubModal: e.currentTarget.dataset.key }); },
  closeModal() { this.setData({ activeSubModal: null }); },

  /* 卡片导入/导出：直接进入管理页（导入是必经流程） */
  openAdminEntry() {
    store.haptic();
    wx.navigateTo({ url: '/pages/admin/index' });
  },

  /* ============ 每日任务配额（新卡 / 到期复习）============ */

  openQuotaModal() {
    store.haptic();
    this.setData({ showQuotaModal: true });
    this._refreshQuotaHint();
  },

  closeQuotaModal() { this.setData({ showQuotaModal: false }); },

  /* 点选新卡预设：立即生效（与「单批卡片数」一致的一步到位写法） */
  quotaNewPreset(e) {
    const v = Number(e.currentTarget.dataset.value) || 20;
    store.setSettings({ newPerDay: v });
    this.setData({ newPerDay: v, examPlan: store.getExamPlan() });
    this._refreshQuotaHint();
    store.haptic();
  },

  /* 点选到期复习上限：0 = 不限 */
  quotaReviewPreset(e) {
    const v = Number(e.currentTarget.dataset.value);
    const val = isFinite(v) && v > 0 ? v : 0;
    store.setSettings({ reviewPerDay: val });
    this.setData({ reviewPerDay: val });
    this._refreshQuotaHint();
    store.haptic();
  },

  /**
   * 弹层内的实时反馈：估算首轮天数，并在排不下时给出建议值。
   * 公式与 scripts/sim_exam_capacity.cjs 一致：首轮天数 = 待学新卡 ÷ 每日新卡；
   * 可用天数 = 备考天数 × 2/3（留 1/3 巩固）。
   */
  _refreshQuotaHint() {
    const s = store.getSettings();
    const plan = store.getExamPlan();
    let hint = '';
    let warn = false;
    if (plan) {
      if (plan.newLeft === 0) {
        hint = '新卡已全部过完首轮。距考试 ' + plan.days + ' 天，专心复习保持保留率即可。';
      } else {
        hint = '待学新卡 ' + plan.newLeft + ' 张，按每天 ' + s.newPerDay + ' 张约需 '
          + plan.firstRoundDays + ' 天过完首轮；距考试 ' + plan.days + ' 天，'
          + '建议把新卡压在前 ' + plan.usableDays + ' 天内学完（留 ' + (plan.days - plan.usableDays) + ' 天巩固）。';
        warn = !plan.enough;
        if (warn) hint += ' 当前速度偏慢，建议提到 ' + plan.needPerDay + ' 张/天。';
      }
    } else {
      let newLeft = 0;
      store.getCards().forEach(function (c) { if (c.state === 'new') newLeft++; });
      const days = s.newPerDay > 0 ? Math.ceil(newLeft / s.newPerDay) : 0;
      hint = '待学新卡 ' + newLeft + ' 张，按每天 ' + s.newPerDay + ' 张约需 ' + days
        + ' 天过完首轮。设置「考试日期」后可反推所需速度并给出预警。';
    }
    this.setData({ quotaHint: hint, quotaWarn: warn });
  },

  /* 考试日期选择（原生 date picker，选完即生效） */
  onExamDateChange(e) {
    const v = e.detail.value || '';
    store.setSettings({ examDate: v });
    store.haptic();
    const days = store.daysToExam(v);
    this.setData({ examDate: v, examDays: days || 0, examPlan: store.getExamPlan() });
    wx.showToast({ title: days ? '距考试还有 ' + days + ' 天' : '已设置考试日期', icon: 'none' });
  },

  /* 清除考试日期（回到「未设置」，预警随之消失） */
  clearExamDate() {
    store.setSettings({ examDate: '' });
    store.haptic();
    this.setData({ examDate: '', examDays: 0, examPlan: store.getExamPlan() });
    wx.showToast({ title: '已清除考试日期', icon: 'none' });
  },

  /* ============ 间隔上限（考前压缩）============ */

  /**
   * 改间隔上限。
   * 只影响**后续排期**：已排定的 nextReviewDate 不会回溯重算（那会把
   * 「今天已做完的卡」重新翻出来，属于破坏性操作）。所以文案要说清这一点，
   * 否则用户会以为「设了 60 天怎么明天还是这些卡」。
   */
  onIntervalChange(e) {
    const idx = Number(e.detail.value);
    const days = this.data.intervalValues[idx];
    if (!days) return;
    store.setSettings({ maxIntervalDays: days });
    store.haptic();
    this.setData({ maxIntervalDays: days, intervalIndex: idx });
    wx.showToast({ title: '间隔上限已设为 ' + days + ' 天', icon: 'none' });
  },

  /* ============ 每轮学习卡片数量设置 ============ */

  /* 打开数量设置弹层：当前默认值若是预设值则高亮，否则进入自定义并预填 */
  openCountModal() {
    const cur = store.getSettings().studyCount;
    const isPreset = cur === 30 || cur === 40 || cur === 60;
    this.setData({
      showCountModal: true,
      countPick: isPreset ? cur : 30,
      countPickCustom: !isPreset,
      countCustomVal: !isPreset ? String(cur) : ''
    });
  },

  closeCountModal() { this.setData({ showCountModal: false }); },

  /* 点选预设数量：立即写入全局设置并关闭（一步到位，不依赖二次「保存」） */
  countPreset(e) {
    const val = Number(e.currentTarget.dataset.value) || 30;
    store.setSettings({ studyCount: val });
    this.setData({ studyCount: val, countPick: val, countPickCustom: false, showCountModal: false });
    store.haptic();
    wx.showToast({ title: '已设为每轮 ' + val + ' 张', icon: 'none' });
  },

  /* 切换为自定义输入（输入后点「保存」生效） */
  countCustomOpt() {
    // 预填当前默认值，方便在原值基础上微调
    if (!this.data.countCustomVal) {
      this.setData({ countPickCustom: true, countCustomVal: String(this.data.studyCount || 30) });
    } else {
      this.setData({ countPickCustom: true });
    }
    store.haptic();
  },

  /* 自定义数量输入（仅保留数字） */
  countInput(e) {
    this.setData({ countCustomVal: (e.detail.value || '').replace(/[^\d]/g, '') });
  },

  /* 事件冒泡占位（防止点击弹层内部内容关闭弹层 / 输入框冒泡） */
  noop() {},

  /* 保存每轮数量到全局设置 */
  saveCount() {
    let val = this.data.countPick;
    if (this.data.countPickCustom) {
      const n = parseInt(this.data.countCustomVal, 10);
      if (!n || n < 1) {
        wx.showToast({ title: '请输入有效的卡片数量', icon: 'none' });
        return;
      }
      val = n;
    }
    store.setSettings({ studyCount: val });
    this.setData({ studyCount: val, showCountModal: false });
    store.haptic();
    wx.showToast({ title: '已设为每轮 ' + val + ' 张', icon: 'none' });
  }
});
