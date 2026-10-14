const store = require('../../utils/store.js');

/* 生成 'YYYY-MM-DD'（与 store 内 todayStr 同格式） */
function dateKey(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/* 学习时长展示（统一用分钟）：
   0/无 → '—'，不足 1 分钟 → '<1 min'，否则整数分钟 */
function minText(sec) {
  const s = sec || 0;
  if (s <= 0) return '—';
  if (s < 60) return '<1 min';
  return Math.round(s / 60) + ' min';
}

/* 保留/错误率展示：无数据(-1) → '—'，否则百分数 */
function pctText(v) {
  return v < 0 ? '—' : v + '%';
}

Page({
  data: {
    dark: false,
    total: 0,
    mastered: 0,
    learning: 0,
    newCount: 0,
    streak: 0,
    wrongCount: 0,
    favCount: 0,
    masteredRate: 0,
    deckStats: [],
    /* 今日学习记录 */
    todaySec: 0,
    todayRated: 0,
    todayMinText: '—',
    todayKeepRate: -1,
    todayKeepText: '—',
    todayErrRate: -1,
    todayErrText: '—',
    week: []
  },

  onShow() {
    /* 本地工具：关闭「转发」与「分享到朋友圈」入口（与「备忘录」类目释义一致） */
    wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    const settings = store.getSettings();
    store.applyNavBar(settings.dark);
    this.rebuild();
  },

  rebuild() {
    const cards = store.getCards();
    const stats = store.getStats();
    const settings = store.getSettings();

    const mastered = cards.filter(function (c) { return c.state === 'mastered'; }).length;
    const learning = cards.filter(function (c) { return c.state === 'learning' || c.state === 'review'; }).length;
    const newCount = cards.filter(function (c) { return c.state === 'new'; }).length;
    const total = cards.length;

    // 学习进度：按题集（deck）分组统计 新卡/学习中/复习中（已掌握卡间隔已很长，归入复习中——到期会自动回到复习队列）
    const groups = {};
    const order = [];
    cards.forEach(function (c) {
      const name = c.deck || '默认牌组';
      if (!groups[name]) {
        groups[name] = { name: name, total: 0, newCount: 0, learningCount: 0, reviewCount: 0, mastered: 0 };
        order.push(name);
      }
      const g = groups[name];
      g.total++;
      if (c.state === 'new') g.newCount++;
      else if (c.state === 'learning') g.learningCount++;
      else g.reviewCount++;
      if (c.state === 'mastered') g.mastered++;
    });
    order.sort(function (a, b) {
      if (a === '默认牌组') return 1;
      if (b === '默认牌组') return -1;
      return 0;
    });
    const deckStats = order.map(function (n) {
      const g = groups[n];
      g.rate = g.total > 0 ? Math.round(g.mastered * 100 / g.total) : 0;
      return g;
    });

    /* ---- 今日学习记录 + 趋势（数据来自 store.recordStudy 埋点） ---- */
    const daily = stats.daily || {};
    const now = new Date();
    const todayKey = dateKey(now);
    // 趋势从「首次有学习记录的那天」开始展示：有几天显示几天，最多滚动近 7 天。
    // 避免新用户/前几天一排空白（旧行为固定铺满最近 7 个自然日，无数据天全为 —）
    let span = 1;
    const dailyKeys = Object.keys(daily).sort();
    if (dailyKeys.length) {
      const pa = dailyKeys[0].split('-').map(Number);
      const diffDays = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
      span = Math.min(7, Math.max(1, diffDays + 1));
    }
    const keys = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      keys.push(dateKey(d));
    }
    const t = daily[todayKey] || { sec: 0, rated: 0, kept: 0 };
    const todaySec = t.sec || 0;
    const todayRated = t.rated || 0;
    const todayKept = t.kept || 0;
    const todayKeepRate = todayRated > 0 ? Math.round(todayKept * 100 / todayRated) : -1;
    const todayErrRate = todayKeepRate < 0 ? -1 : (100 - todayKeepRate);

    // 趋势行（今天在前，最早到首次有记录日，最多 7 行）
    const weekRaw = keys.slice().reverse().map(function (key) {
      const d = daily[key] || { sec: 0, rated: 0, kept: 0 };
      const keepRate = (d.rated || 0) > 0 ? Math.round((d.kept || 0) * 100 / d.rated) : -1;
      return {
        key: key,
        label: key.slice(5),
        isToday: key === todayKey,
        sec: d.sec || 0,
        min: Math.round((d.sec || 0) / 60),
        keepRate: keepRate
      };
    });
    const maxMin = weekRaw.reduce(function (m, r) { return Math.max(m, r.min); }, 0);
    const week = weekRaw.map(function (r) {
      return {
        key: r.key,
        label: r.label,
        isToday: r.isToday,
        minText: minText(r.sec),
        keepText: pctText(r.keepRate),
        keepRate: r.keepRate,
        barW: maxMin > 0 ? Math.max(r.min > 0 ? 6 : 0, Math.round(r.min * 100 / maxMin)) : 0
      };
    });

    this.setData({
      dark: settings.dark,
      total: total,
      mastered: mastered,
      learning: learning,
      newCount: newCount,
      streak: stats.streakDays || 0,
      wrongCount: (stats.wrongCardIds || []).length,
      favCount: (stats.favoriteCardIds || []).length,
      masteredRate: total > 0 ? Math.round(mastered * 100 / total) : 0,
      deckStats: deckStats,
      todaySec: todaySec,
      todayRated: todayRated,
      todayMinText: minText(todaySec),
      todayKeepRate: todayKeepRate,
      todayKeepText: pctText(todayKeepRate),
      todayErrRate: todayErrRate,
      todayErrText: pctText(todayErrRate),
      week: week
    });
  },

  goWrong() { wx.navigateTo({ url: '/pages/wrong/index' }); },
  goFav() { getApp().globalData.anki.selectedStage = 'all'; wx.switchTab({ url: '/pages/anki/index' }); }
});
