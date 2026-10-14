# memory-tools

六西格玛黑带记忆卡 —— 原生微信小程序（备份仓库）。

一个纯本地的间隔重复记忆卡工具：卡片内容由使用者自行导入，全部保存在本机，不上传、不公开、不共享。工具本身不提供任何学习内容。

## 技术要点

- **原生微信小程序**框架（无 Taro / uni-app 等跨端层），`libVersion 3.5.0`
- 双间隔重复算法：**FSRS**（主）+ **SM-2**（兼容/回退）
- 自定义 tabBar（`custom-tab-bar/`），5 个页面
- 数据本地持久化，导入支持 CSV / Anki 导出格式

## 目录结构

```
.
├── app.js / app.json / app.wxss    # 小程序入口
├── config.js                        # 全局运行配置（版本号、联系方式、定位声明）
├── project.config.json              # 项目配置（含 appid）
├── sitemap.json
├── custom-tab-bar/                  # 自定义底部导航栏
├── data/                            # 内置/示例卡片数据
│   ├── builtinLocal.js
│   ├── defaultCards.js
│   └── sampleCards.js
├── images/tab/                      # 导航栏图标
├── pages/
│   ├── anki/                        # 首页 · 刷题/复习
│   ├── stats/                       # 进度看板
│   ├── settings/                    # 设置
│   ├── wrong/                       # 错题
│   └── admin/                       # 管理
└── utils/
    ├── cardShards.js                # 卡片分片（大题库拆分）
    ├── fsrs.js                      # FSRS 间隔重复算法
    ├── sm2.js                       # SM-2 间隔重复算法
    ├── importer.js                  # 数据导入（CSV / Anki）
    ├── scheduler.js                 # 复习调度
    ├── store.js                     # 本地存储层
    └── rich.js                      # 富文本渲染
```

## 打开方式

用微信开发者工具「导入项目」选择本目录，填入自己的 AppID（`project.config.json` 中的 `appid` 为本项目原 AppID，可用「测试号」或改为自己的）。

> 注：`project.private.config.json` 为本机私有配置，已加入 `.gitignore`，不入库。

## 版本

见 `config.js` 中的 `APP_VERSION`（当前 `1.0.1`）。该值与上传时的 `cli upload -v <x.y.z>` 是**两个独立的值**，改版本号需同时修改两处。
