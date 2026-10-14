const store = require('../utils/store.js');

/**
 * 自定义底部导航条（替代原生 tabBar，高度紧凑）。
 * - 纯文字、无图标：主体高度 76rpx，约为原生 tabBar 的一半
 * - hidden=true 时整条隐藏（刷题模式由 anki 页控制，最大化题目区域）
 * - 选中态与深色模式随路由 / 设置自动同步
 */
Component({
  data: {
    selected: 0,
    hidden: false,
    dark: false,
    list: [
      { pagePath: 'pages/anki/index', text: '首页', icon: '🏠' },
      { pagePath: 'pages/stats/index', text: '进度看板', icon: '📊' },
      { pagePath: 'pages/settings/index', text: '设置', icon: '⚙️' }
    ]
  },

  lifetimes: {
    attached() {
      this.sync();
    }
  },

  pageLifetimes: {
    show() {
      // 切到任一 tab 页时刷新选中项与主题；hidden 由各页面自行控制，此处不覆盖
      this.sync();
    }
  },

  methods: {
    /* 按当前路由刷新选中项与深色状态（settings 切换主题后也可主动调用） */
    sync() {
      let selected = 0;
      try {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        const list = this.data.list;
        for (let i = 0; i < list.length; i++) {
          if (cur && cur.route === list[i].pagePath) { selected = i; break; }
        }
      } catch (e) { /* ignore */ }
      let dark = false;
      try { dark = !!store.getSettings().dark; } catch (e) { /* ignore */ }
      this.setData({ selected: selected, dark: dark });
    },

    onTap(e) {
      const path = e.currentTarget.dataset.path;
      if (!path) return;
      wx.switchTab({ url: '/' + path });
    }
  }
});
