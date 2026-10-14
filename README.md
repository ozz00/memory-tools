# memory-tools

六西格玛黑带记忆卡 —— 备考记忆工具。含**原生微信小程序**（发布产物）与 **React H5 原型**（早期版本，不参与发布）。

## 项目定位

纯本地的间隔重复记忆卡工具：卡片内容由使用者自行导入，全部保存在本机，不上传、不公开、不共享。工具本身不提供任何学习内容。

## 目录结构

```
.
├── miniprogram/          # 📦 发布产物 · 原生微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── config.js         # 版本号 / 联系方式 / 定位声明（单一来源）
│   ├── custom-tab-bar/   # 自定义底部导航栏
│   ├── data/             # 内置与示例卡片
│   ├── images/tab/       # 导航栏图标
│   ├── pages/            # anki / stats / settings / wrong / admin
│   └── utils/            # fsrs / sm2 / importer / scheduler / store / cardShards / rich
├── src/                  # 🧪 旧 React H5 原型（不参与发布）
├── scripts/              # 🧪 回归与真机验证脚本
├── docs/                 # 方案评估 / 发布清单 / 推广文案
├── public/
├── index.html            # H5 原型入口
├── package.json          # H5 原型的依赖与脚本
└── vite.config.ts / tsconfig.json
```

## 小程序（`miniprogram/`）

- 原生微信小程序框架，`libVersion 3.5.0`
- 双间隔重复算法：**FSRS**（主）+ **SM-2**（兼容 / 回退）
- 自定义 tabBar，5 个页面：首页刷题、进度看板、设置、错题本、管理控制台
- 数据本地持久化；导入支持 CSV 与 Anki 导出格式
- 微信单 key 存储上限 1 MB → 卡片按**下标锚定分片**存储（每片 200 条），改一张卡不会级联重写
- 版本号见 `miniprogram/config.js` 的 `APP_VERSION`（与上传时的 `cli upload -v <x.y.z>` 是**两个独立的值**，需同时修改）

用微信开发者工具「导入项目」选择 `miniprogram/` 目录即可。

## H5 原型（`src/`）

早期 React + Vite 版本，用于交互原型验证，**不参与小程序发布**。

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # 产物在 dist/
npm run lint    # tsc --noEmit
```

## 测试脚本（`scripts/`）

基于 `miniprogram-automator` 的回归与真机验证脚本：

| 前缀 | 类型 | 是否需要开发者工具 |
|---|---|---|
| `regress_*.cjs` | 纯逻辑回归（Node 侧） | 否 |
| `verify_*_live.cjs` | 模拟器端到端验证 | 是（需自动化端口） |
| `check_wxml.py` | WXML 静态检查 | 否 |
| `run_all.sh` | 批量执行 | 视脚本而定 |

```bash
node scripts/regress_sm2_schedule.cjs      # 单跑
bash scripts/run_all.sh                    # 批量
```

`_testenv.cjs` / `_liveenv.cjs` 是公共测试环境准备层：因根 `package.json` 为 `type: module`，Node 直接 `require` 项目内 `.js` 会按 ESM 解析失败，故复制到临时目录改 `.cjs` 再加载；小程序侧无此问题。

## 说明

- 本仓库为项目源码备份。
- **不入库**：`project.private.config.json`（微信开发者工具本机私有配置）、`.workbuddy/`（AI 编程助手工作笔记）、`node_modules/`、`.env*`（保留 `.env.example`）。
- `project.config.json` 中的 AppID 为本项目原 AppID，第三方使用请改为自己的 AppID 或使用测试号。
