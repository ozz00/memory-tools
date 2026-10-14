const store = require('./utils/store.js');

App({
  globalData: {
    settings: null,
    // 最近一次学习会话状态，用于跨页面返回时保持进度
    anki: {
      selectedStage: 'all',
      index: 0
    }
  },

  onLaunch() {
    const settings = store.getSettings();
    this.globalData.settings = settings;
    store.applyNavBar(settings.dark);
  },

  onShow() {
    const settings = store.getSettings();
    this.globalData.settings = settings;
  }
});
