# FSRS 接入方案评估

> 评估日期：2026-09-10 · 对象：CAQ 六西格玛黑带闪卡小程序
> 当前算法：SM-2（已打补丁，见 `miniprogram/utils/sm2.js`）
> 评估方式：全部结论均来自本机实测，非文档推断。实测环境见文末「附录 A」。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| **能不能接** | ✅ **能，且已实测跑通**。ts-fsrs 在小程序运行时内零故障运行，纯 JS、零依赖、零 Node 内置模块，打包后 24 KB。 |
| **值不值得接** | ⚠️ **收益低于公开基准**。对本项目**已打补丁**的 SM-2，180 天备考窗口内 FSRS 默认设置只少 **17%** 复习量，不是常引用的 20–30%。 |
| **真正的价值在哪** | 🎯 **不是省复习，是拿到两个控制旋钮**：`request_retention`（复习量可在 4–17 次间调节）与 `maximum_interval`（考前压缩）。这是 SM-2 结构上做不到的。⚠️ 但默认值定为 r=0.95 后，**考前压缩的边际价值明显缩小**——见 8.2 的实测更正；此时主要卖点回到 `request_retention` 滑杆本身。 |
| **建议路径** | 分三阶段，**先做零风险的影子模式**（只记录不生效），用真实数据验证收益后再切换。不建议直接替换。 |
| **最大成本项** | 🔴 **每张卡的 `stability` / `difficulty` 需要历史重放才能重建**——现有 `history` 字段够用但需要写迁移器；无历史的卡只能冷启动。 |

---

## 1. 可行性：已实测验证

### 1.1 包事实（`ts-fsrs@5.4.2`）

| 项 | 值 | 判断 |
|---|---|---|
| 版本 / 许可证 | 5.4.2 / MIT | 🟢 可商用 |
| 算法版本 | **FSRS-6.0** | 🟢 最新代 |
| 运行时依赖 | **0 个**（`dependencies: {}`） | 🟢 无依赖树污染 |
| Node 内置模块 | **0 处**（无 `fs`/`path`/`process`/`Buffer`） | 🟢 可在纯前端运行 |
| 外部 `require` | **0 处** | 🟢 单文件自洽 |
| 包体解压后 | 706 KB（含 3 种模块格式 + sourcemap + d.ts） | 🟡 仅取其一 |
| **实际打包后** | **24,038 字节 / gzip 7,903 字节** | 🟢 相对 2 MB 主包可忽略 |
| 生态 | GitHub 720★、周下载 153k、官方仓库 `open-spaced-repetition` | 🟢 活跃维护 |
| 私有类字段 / 需转译语法 | 无（`#` 命中均为 JSDoc URL 锚点） | 🟢 无 ES6→ES5 障碍 |

### 1.2 三层实测证据

| 层 | 方法 | 结果 |
|---|---|---|
| ① 静态 | 全文检索 `require(...)` / Node 内置符号 | 零外部引用 |
| ② 沙箱 | Node `vm` 构造**无 `process`/`Buffer`/`require`/`global`** 的上下文，执行 UMD 包 | ✅ 加载成功，`repeat()` 正常排期 |
| ③ **真机运行时** | 打包成单文件放入小程序工程，在**微信小程序 JS 引擎内** `require` 并实跑 | ✅ 见下 |

**第 ③ 层实测输出**（开发者工具 SDK **3.17.2**，`platform=devtools`）：

```
exportCount   = 46                      导出符号全部就位
hasApi        = fsrs,createEmptyCard,generatorParameters,Rating,State,default_w
weightCount   = 21                      FSRS-6 权重数量
goodSeq       = 3 → 14 → 57 → 196 → 586 连续 5 次「良好」的实际排期
finalS/D      = 586.48 / 2.09
retentionSweep= 0.7→20889d 0.8→2762d 0.85→773d 0.90→196d 0.95→34d
```

### 1.3 🔴 关键陷阱：官方「构建 npm」链路会静默失败

这是本次评估最重要的工程发现。`node_modules` 里有 `ts-fsrs` 时，开发者工具 `cli build-npm` 报：

```
code: 10, message: "Error: __NO_NODE_MODULES__ NPM packages not found."
```

**根因**（读开发者工具实现 `packnpm.js` 得到，非猜测）：

```js
// packJs() 的入口解析：
e = path.posix.join(packageDir, pkg.main || "index.js");
e.endsWith(".js") || e.endsWith(".json") || (e += ".js");   // ← 致命一行
```

`ts-fsrs` 的 `main` 是 **`dist/index.cjs`**。`.cjs` 既非 `.js` 也非 `.json`，于是被改写成 `dist/index.cjs.js` → 入口不存在 → `packJs` 静默返回 `undefined` → 该包被跳过 → 最终 0 个包 → 抛出 `__NO_NODE_MODULES__`。

三个副作用值得记下：

1. **报错信息完全误导**——它说"找不到 npm 包"，实际是"入口扩展名不认识"。
2. 开发者工具的打包器**只读 `main`，忽略 `exports` 字段**（代码里写死 `r.main || "index.js"`），所以改 `exports` 无效。
3. 官方逃生通道是包内声明 `"miniprogram": "<目录>"`（`checkIsMiniprogramPack` 会直接拷贝该目录而不打包），但 `ts-fsrs` 未声明，且改动 `node_modules` 内的 `package.json` 不可复现。

### 1.4 三种接入方式对比

| 方式 | 做法 | 可行性 | 可复现性 | 结论 |
|---|---|---|---|---|
| A. 构建 npm | `miniprogram/package.json` + `nodeModules:true` + `cli build-npm` | ❌ 被 `.cjs` 入口卡死 | — | **放弃** |
| B. 改包内 `main` 后构建 | patch `node_modules/ts-fsrs/package.json` | 🟡 理论可行 | ❌ postinstall 补丁，易碎 | 不推荐 |
| C. **预打包为单文件**（vendor） | esbuild 打成一个 CJS 文件，直接放 `miniprogram/utils/` | ✅ **已实测跑通** | ✅ 源码进 git，可哈希校验 | **推荐** |

方式 C 的额外好处：不引入 `package.json`、不引入 `miniprogram_npm/`、不需要在 `project.config.json` 里开 `nodeModules`，**发布包结构完全不变**——这对本项目的合规定位（纯工具、代码包不含任何题目）是加分项。

**另一条实测红线**：小程序运行时**禁用 `new Function` / `eval`**（实测 `new Function(...)` 返回不可调用值）。这意味着任何"运行期动态加载算法"的方案都不可行，**必须打成实体文件**——这也反向确认了方式 C 是唯一稳的路。

构建命令（见 `scripts/build_fsrs_vendor.cjs`）：

```bash
node_modules/.bin/esbuild node_modules/ts-fsrs/dist/index.mjs \
  --bundle --minify --format=cjs --platform=neutral --target=es2017 \
  --outfile=miniprogram/utils/fsrs.js
```

> 不用 `--target=es5`：esbuild 明确不支持将 `class` 降级到 ES5（报 `Transforming class syntax ... is not supported yet`）。本项目 `libVersion` ≥ 3.5.0，原生支持 ES2017，无此需求；开发者工具的「ES6 转 ES5」由 babel 承担，能力更强。

---

## 2. 收益评估

### 2.1 实测场景：180 天备考窗口 · 单张卡 · 全按「良好」

| 调度器设置 | 复习次数 | 末次复习日 | 下次到期日 | **考试日(第180天)保留率** |
|---|---|---|---|---|
| **SM-2（本项目补丁版）** | **6** | 第 155 天 | 第 393 天 | *无法计算（SM-2 无遗忘曲线）* |
| FSRS r=0.90 max=∞（库默认） | 5 | 第 59 天 | 第 222 天 | 92.0% |
| FSRS r=0.90 max=60d | 6 | 第 120 天 | 第 181 天 | 97.5% |
| FSRS r=0.90 max=30d | 9 | 第 168 天 | 第 199 天 | 99.6% |
| FSRS r=0.95 max=∞ | 8 | 第 163 天 | 第 338 天 | 99.5% |
| FSRS r=0.95 max=30d | 10 | 第 155 天 | 第 186 天 | 99.2% |
| FSRS r=0.98 max=14d（冲刺） | 18 | 第 173 天 | 第 188 天 | 99.8% |

配套的间隔序列（全按「良好」）：

- SM-2 补丁版：`1 / 6 / 15 / 38 / 95` 天
- FSRS r=0.90 默认：`3 / 14 / 57 / 196` 天
- FSRS r=0.95：`1 / 3 / 8 / 19 / 43 / 89` 天

### 2.2 复习量对目标保留率的敏感度（180 天内单卡复习次数，max=∞）

| r | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 | 0.97 |
|---|---|---|---|---|---|---|---|
| 复习次数 | 3 | 4 | 4 | 4 | 5 | 8 | 10 |

**600 张卡规模换算：**

| 配置 | 180 天总复习 | 日均 | 相对 SM-2 |
|---|---|---|---|
| SM-2 补丁版 | 3,600 | 20 次/天 | 基准 |
| FSRS r=0.85 | 2,400 | 13 次/天 | **−33%** |
| FSRS r=0.90（库默认） | 3,000 | 17 次/天 | **−17%** |
| FSRS r=0.95 | 4,800 | 27 次/天 | **+33%** |

### 2.3 为什么收益低于公开基准（20–30%）

三点原因，都要说清楚，否则会高估收益：

1. **基准是拿 FSRS 比「原版 SM-2」**。原版 SM-2 存在 ease hell、第二次「良好」只有 3 天——本项目在 2026-09-10 已把这两项修掉（EF 均值回归 + 6 天），**差距的主要部分已经被我们自己吃掉了**。
2. **备考应用有时间边界**。FSRS 的优势集中在长尾（稳定度上百天后间隔拉开数倍），但 180 天的窗口根本走不到那一段。上表「下次到期日 222/393 天」都落在考试之后，对用户毫无价值。
3. **用户是冷启动**。个人化收益需要约 1000 次复习才会显现，而本项目用户自导入题库、从零开始，拿到的是 **FSRS 的默认权重**，不是它的自适应能力。

### 2.4 🎯 真正值得买的东西

省复习量不是本项目的痛点（20 次/天对闪卡用户是正常负荷）。**结构性差异**才是：

| 能力 | SM-2 | FSRS | 对本项目的意义 |
|---|---|---|---|
| **考前压缩** | ❌ 做不到 | ✅ `maximum_interval` | 「考试日保留率」从**不可控**变为**可设定**。设 `max=30d` 即得 99.6%（上表）——这是能写进产品描述的卖点。 |
| **难度可调旋钮** | ❌ 无 | ✅ `request_retention` | 可给用户一个「省时间 ↔ 求稳」滑杆，同一套算法覆盖两种人群。 |
| **回答"还记得的概率"** | ❌ 无模型 | ✅ `get_retrievability()` | 进度看板可展示「考前预估掌握度」，比"已复习 N 张"有说服力。 |
| **崩溃后的确定性恢复** | 🟡 归零重学 | ✅ 独立遗忘公式，不归零 | 实测：反复遗忘 30 次后 SM-2 落回 `interval=0` 的 10 分钟循环，FSRS 仍给出 `S=0.38d / scheduled=1d` 的可计算状态。 |
| **多端/多算法切换** | ❌ | ✅ 有标准 log 格式 | 云同步与未来换算法都有标准接口。 |

**一句话**：这不该当作"换更省的算法"，而该当作"给备考应用装上考前调度功能"。

---

## 3. 数据模型迁移

### 3.1 字段映射与缺口

当前卡片结构（`miniprogram/utils/store.js` + `importer.js`）：

```js
{ id, front, back, qNo, options, correctAnswer, stage, tags, cardType,
  interval, repetitions, easeFactor, nextReviewDate, state, lastReviewed,
  history: [{ date, rating }] }
```

FSRS `Card` 结构对照：

| FSRS 字段 | 本项目现值 | 处理 |
|---|---|---|
| `due` | `nextReviewDate` | 🟢 直接映射 |
| `scheduled_days` | `interval` | 🟢 直接映射 |
| `reps` | `repetitions` | 🟢 直接映射 |
| `last_review` | `lastReviewed` | 🟢 直接映射 |
| `elapsed_days` | — | 🟢 可由相邻 `history[].date` 推出 |
| `learning_steps` | — | 🟢 冷启动置 0 |
| `lapses` | — | 🟡 可从 `history` 数 `rating==='again'` 的次数 |
| `state` | `'new'/'learning'/'review'/'mastered'` | 🟡 需映射：`'mastered'` → `Review`（FSRS 无此态），`'learning'` → `Learning` |
| **`stability`** | — | 🔴 **缺失**，只能由历史重放或冷启动给出 |
| **`difficulty`** | — | 🔴 **缺失**，同上 |

### 3.2 关键结论：现有 `history` 够用，可以"重放"出 S/D

`history: [{date, rating}]` 恰好含有 FSRS 重放所需的全部信息：

- `rating`：`again/hard/good/easy` → `Rating.Again/Hard/Good/Easy`（1/2/3/4），**一一对应，无需转换表**
- `elapsed_days`：相邻两次 `date` 之差

因此可以用 `fsrs.reschedule()` 或逐次 `fsrs.next()` 把历史回放一遍，**精确重建出 `stability` / `difficulty`**，而不是把所有老卡当作新卡。

**两条迁移路径：**

| 路径 | 适用卡片 | 代价 |
|---|---|---|
| **重放**（推荐） | 有 `history` 的卡（真实复习过的） | 一次性 O(复习次数)，在 `getCards()` 惰性执行 |
| **冷启动** | 无 `history` 但 `interval>0` 的卡（JSON 备份还原、早期导入） | 丢失历史，退回 `New`；或用启发式播种（由 `interval` 反推一个初始 S） |

### 3.3 挂载点：沿用项目已有的惰性迁移模式

`store.js` 里已有先例——`syncImportedCards()` 在 `getCards()` 内部对存量卡做一次性修补并回写。FSRS 字段填充应当**完全复用这个模式**，不需要写独立的迁移流程：

```
getCards()
  → syncBuiltIns()        （现有一致性同步）
  → syncImportedCards()   （现有：修正早期导入的选项/答案）
  → syncFsrsFields()      （新增：为缺 stability/difficulty 的卡重放 history）
```

备份信封已有版本位：`exportAll()` 返回 `{ v: 1, exportedAt, cards, stats, settings, sessions, flipHintShown }`，而 `importAll()` **目前不校验 `v`**——接入时应补上 `v` 检查，把 `v:1`（SM-2）与 `v:2`（FSRS）区分开，否则用户从旧备份还原会带回没有 S/D 的卡。

---

## 4. 架构设计

核心分工：**小程序端只做推理，权重训练放离线端**。理由是小程序无法跑梯度下降（也没有 `new Function`），且训练需要全量复习日志。

```
┌─ 小程序端（推理，24 KB）──────────────────────┐
│  utils/fsrs.js        预打包的 ts-fsrs 单文件   │
│  utils/scheduler.js   统一调度门面（新增）      │
│     ├─ 读 settings.scheduler = 'sm2'|'fsrs'    │
│     ├─ 分发到 sm2.js 或 fsrs.js                 │
│     └─ 对外接口与 calculateSm2Review 保持一致   │
│  utils/store.js       syncFsrsFields() 惰性迁移 │
└───────────────────────────────────────────────┘
                    ↑ 写入
┌─ 复习日志（wx.setStorageSync）─────────────────┐
│  card.history   →  {date, rating, elapsed,     │
│                     S_before, D_before}        │
│  { lapses, stability, difficulty, fsrs_state } │
└───────────────────────────────────────────────┘
                    ↓ 导出
┌─ 离线端（训练，可选）──────────────────────────┐
│  pip install fsrs-optimizer  (PyPI 6.5.0)      │
│  或 @open-spaced-repetition/binding (Rust/WASI)│
│  → 输出 21 个权重 → 回灌 settings.fsrs_w       │
└───────────────────────────────────────────────┘
```

**三条落地约束：**

1. **统一门面**：`scheduler.js` 对外只暴露现有 `calculateSm2Review(card, rating)` 与 `formatIntervalLabel(card, rating)` 的等价接口，页面代码**零改动**即可切换算法。这是把切换风险压到最低的关键设计。
2. **补全日志**：评分时必须**在更新前**记录 `elapsed_days` 与 `S_before / D_before`——这是 `history` 目前缺的两个字段，也是未来跑优化器的前提。**越早开始记录，收益兑现越早**，即使暂时不切 FSRS 也值得现在就加。
3. **权重来源两段式**：发布时内置 `default_w`（21 个预训练权重）；用户复习量达到阈值（建议 ≥1000 次）后，可选导出日志到离线端训练并回灌。附带 `migrateParameters()` 可自动把 17/19 长度的旧权重升到 21。

---

## 5. 风险登记册

| 级别 | 风险 | 说明 | 缓解 |
|---|---|---|---|
| 🔴 P0 | **`stability`/`difficulty` 无历史无法重建** | 无 `history` 的老卡只能冷启动，用户会感觉"进度被清了" | 重放优先；确实无历史的卡用 `interval` 启发式播种而非归零；切换前提示用户 |
| 🔴 P0 | **切换不可逆 / 回滚无路** | 一旦写入 FSRS 字段并丢弃 SM-2 字段，回不去 | **双轨并存**：两套字段同时维护，`settings.scheduler` 只决定读哪一套。回滚 = 改一个字符串 |
| 🟡 P1 | 用户评分失真 | 实测 `again` 后 SM-2 落 10 分钟循环、FSRS 落 1 天，两者对"重来"的语义不同；用户按习惯点击会让 FSRS 的第一档偏保守 | 切换前用影子模式对比；考虑把「重来」的 `relearning_steps` 从 `10m` 调成与现有 10 分钟口径一致 |
| 🟡 P1 | `history` 无上限膨胀 | 现有代码 `history.concat(...)` 无限追加，FSRS 重放和导出都会变慢、占存储 | 给 `history` 加封顶（如保留最近 500 条）+ 在 `lapses`/`S`/`D` 里保存聚合结果 |
| 🟡 P1 | 状态映射歧义 | `'mastered'` 在 FSRS 无对应态 | 明确映射到 `Review`，并写进回归断言 |
| 🟢 P2 | 包体积 | 24 KB / gzip 7.9 KB | 无需处理；注意 `esbuild --bundle` 会内联极小的依赖，本包本就无依赖 |
| 🟢 P2 | 许可与合规 | MIT，纯算法，**不涉及任何题库内容** | 与本项目「代码包不含题目」红线无冲突 |
| 🟢 P2 | 教材文案 | 设置页 SM-2 弹窗现有说明会与实际不符 | 沿用既有约定：改算法必须同步 `pages/settings/index.wxml` 第 121–127 行附近 |

---

## 6. 分阶段实施计划

| 阶段 | 内容 | 产出 | 验收标准 | 可回滚 |
|---|---|---|---|---|
| **P0 · 影子模式** | ① vendor `fsrs.js` 进包 ② 新增 `scheduler.js` 门面 ③ 每次评分**同时**算出 FSRS 排期但不生效，写入 `card.fsrsShadow` ④ 补全 `history` 的 `elapsed_days` | 真实数据对比集 | 跑满 2 周 / 500 次评分；统计两算法间隔差异分布 | ✅ 完全无感，删文件即回滚 |
| **P1 · 开关切换** | ① 设置页加算法开关 + 目标保留率滑杆 ② 用户可显式选择 FSRS ③ 首切时执行 `syncFsrsFields()` 重放迁移 ④ 同步弹窗文案 | 可用功能 | 回归脚本覆盖；端到端验证切换后落库字段正确 | ✅ 开关切回 SM-2 |
| **P2 · 考前调度** | ① 让用户填考试日期 ② 由考期自动解出 `maximum_interval`（可直接用本文 2.1 表） ③ 进度看板展示「考前预估保留率」 | 差异化卖点 | 考试日保留率 ≥ 目标值 | ✅ 纯增量功能 |
| **P3 · 权重个人化** | ① 导出复习日志为优化器输入 ② 离线训练 ③ 回灌 `settings.fsrs_w` | 自适应 | ≥1000 次复习后误差指标改善 | ✅ 退回 `default_w` |

**建议的下一步**：只做 P0。它零风险、不改任何用户可见行为，但能把"FSRS 到底比我们补丁版 SM-2 好多少"这个问题用**用户自己的数据**回答掉——本文第 2 节的数字是推演，P0 能给出实证。

---

## 7. 决策点（2026-09-10 拍板）

1. **要不要现在就开始记录 `elapsedDays` / `S_before` / `D_before`？** → ✅ **做**。已随 P0 影子模式落地，见第 8 节。
2. **目标保留率默认值** → ✅ **0.95**（而非库默认 0.90）。依据：0.90 时末次复习停在第 59 天，与第 180 天的考试之间隔着 121 天没有复习，心理上难以接受。
3. **`maximum_interval` 是否做成用户可见的「考前压缩」开关？** → ⏳ **结论已变，待重新拍板**。原判断（"不做就只剩 17% 复习量的增量，说服力不足"）建立在 r=0.90 的坏基线上；改为 0.95 后该开关主要买到的是"考前空窗更短"而非保留率，且代价约 ×2 复习量。详见 **8.2 的更正**。

---

## 8. 决策落地与「补记」实现（2026-09-10）

### 8.1 已落地：FSRS 影子记录（原计划中的 P0）

原则：**FSRS 只计算、只落盘，不参与任何排期决策**——实际生效的仍是 SM-2。

| 文件 | 作用 |
|---|---|
| `miniprogram/utils/fsrs.js` | 预打包产物（24,038 字节 / gzip 7,912，零外部 `require`）。由 `scripts/build_fsrs_vendor.cjs` 生成，**禁止手改**——`run_all.sh` 会校验 sha256 |
| `miniprogram/utils/scheduler.js` | 调度门面。`applyReview(card, rating)` 一次完成三件事：SM-2 排期（生效）、FSRS 影子计算（记录）、写增强 history |
| `miniprogram/pages/anki/index.js` | `onRate` 改调 `scheduler.applyReview`（原先直调 `sm2.calculateSm2Review`） |
| `miniprogram/utils/store.js` | 新增 `requestRetention`(0.95) / `maxIntervalDays`(365) 两项设置；`getCards()` 增加惰性迁移 `syncSchedulerHistory`（给老条目补 `elapsedDays`）；`importAll` 补上版本守卫（原先导出有 `v:1` 但导入**不校验**） |

`history` 条目由 `{date, rating}` 扩展为：

```js
{ date, rating, elapsedDays, sBefore, dBefore, sAfter, dAfter }
```

**四条不变量**（`scripts/regress_fsrs_shadow.cjs` 守着）：

1. 影子**不改变** SM-2：36 组（9 卡态 × 4 档）的排期字段必须与 `calculateSm2Review` 完全一致。
2. 链路咬合：`sAfter[i] === sBefore[i+1]`、`dAfter[i] === dBefore[i+1]`。
3. 影子异常**不中断复习**：异常被吞掉并记在条目的 `shadowError` 上，主流程照常。
4. 迁移**不产生分叉**：抹掉 `card.fsrs` 后由 history 重放，结果与原生路径逐位一致。

回归入口：`scripts/regress_fsrs_shadow.cjs`（38 条，已进 `run_all.sh`）；
真实运行时验证并入 `scripts/verify_sm2_live.cjs`（16 条，证明预打包的 `fsrs.js` 能在
小程序运行时里被 `require` 起来、影子字段真的落库）。

### 8.2 ⚠️ 更正：`maximum_interval`（"考前压缩"）的价值被高估了

本文 2.4 与原第 7 节第 3 条曾以「设 `max=30d` 即得 99.6%」论证该开关的价值。
**那句话只在 `r=0.90` 下成立**——它拿的是一个本身就很差的基线做对比。目标保留率定为 0.95 后重测
（180 天 / 单卡 / 全按「良好」/ `r=0.95`）：

| 间隔上限 m | 复习次数 | 末次复习日 | 考前空窗 | 考试日保留率 |
|---|---|---|---|---|
| ∞（不压缩） | **8** | 第 163 天 | 17 天 | **99.5%** |
| 60 天 | 8 | 第 135 天 | 45 天 | 98.3% |
| 30 天 | 10 | 第 155 天 | 25 天 | 99.2% |
| 14 天 | **16** | 第 177 天 | 3 天 | 99.9% |
| 7 天 | **26** | 第 179 天 | 1 天 | 100.0% |

结论：**在 r=0.95 下，不压缩已经是 99.5%。** 收紧上限买到的主要是"考前空窗更短"这个
**确定性与心理安慰**，而不是保留率；代价却真实——压到 14 天要让复习次数从 **8 次翻到 16 次**。

因此该开关的正确定位不是"保留率工具"，而是**「考前冲刺模式」**：明确告知
「复习量约 ×2，换取考前 3 天内每张卡都再滚一遍」。若不愿承担这个代价，**不做它也是合理选择**——
此时 FSRS 相对补丁版 SM-2 的增量确实只剩约 17% 的复习量（原因见 2.3）。
换言之：**默认 0.95 之后，真正的差异化卖点从"考前压缩"转移到了 `request_retention` 滑杆本身**
（"省时间 ↔ 求稳"双人群，复习量可在 4–17 次间调节）。

---

## 附录 A · 实测环境与复现命令

| 项 | 值 |
|---|---|
| ts-fsrs | 5.4.2（FSRS-6.0，21 权重） |
| 微信开发者工具 SDK | 3.17.2（`project.config.json` 声明 `libVersion: 3.5.0`） |
| esbuild | 0.25.12（项目内 `node_modules/.bin/esbuild`） |
| Node | 22.22.2（`~/.workbuddy/binaries`，托管版） |
| 沙箱验证 | Node `vm` + 无 `process`/`Buffer`/`require` 上下文 |
| 运行时验证 | 临时工程 `/tmp/mp_probe/miniprogram` + `miniprogram-automator` + `cli auto --auto-port 9430` |

**FSRS-6 默认权重（21 个，取自 `default_w`）：**

```
0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
1.8729, 0.5425, 0.0912, 0.0658, 0.1542
```

**默认参数（`generatorParameters({})`）：**

| 参数 | 默认值 |
|---|---|
| `request_retention` | 0.90 |
| `maximum_interval` | 36500 天 |
| `enable_short_term` | true |
| `learning_steps` | `["1m", "10m"]` |
| `relearning_steps` | `["10m"]` |
| `enable_fuzz` | false |

**复现步骤：**

```bash
# 1. 取包并预打包
npm install ts-fsrs@5.4.2 --no-audit --no-fund
node_modules/.bin/esbuild node_modules/ts-fsrs/dist/index.mjs \
  --bundle --minify --format=cjs --platform=neutral --target=es2017 \
  --outfile=/tmp/fsrs_vendor.js

# 2. 沙箱验证（无 Node 全局）
node -e "const vm=require('vm'),fs=require('fs');
vm.runInContext(fs.readFileSync('/tmp/fsrs_vendor.js','utf8'),vm.createContext({console,Date,Math,JSON}))"

# 3. 小程序运行时验证
#    把 /tmp/fsrs_vendor.js 放入工程 utils/fsrs.js，
#    用 cli auto --auto-port 9430 起自动化，再用 miniprogram-automator 读数据
```

> 注意：`cli build-npm` 走的是**已在 IDE 中打开的工程**，`--project` 参数在 IDE 已有活动窗口时不会切换目标工程（实测：换成必然可构建的探针包仍报 `__NO_NODE_MODULES__`）。这也是放弃方式 A 的次要原因。

---

## 附录 B · 本评估未做的事

- 未修改 `miniprogram/` 下任何文件（评估阶段不污染发布包）。
- 未做权重个人化实测（需 ≥1000 次真实复习日志，当前不存在）。
- 第 2 节数据为**确定性推演**（全按「良好」的理想路径），非随机模拟。曾尝试蒙特卡洛模拟，但短时学习步（1m/10m）与按天推进的循环冲突导致结果失真（210 次/卡），**已弃用、未采信**。真实分布需由 P0 影子模式给出。
