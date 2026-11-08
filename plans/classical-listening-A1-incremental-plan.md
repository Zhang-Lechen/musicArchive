# 古典音乐聆听档案 · A1 增量开发计划

> **适用前提**：已按《古典音乐聆听档案 V2.0 开发方案》完成 **A0｜仓库检查与基础搭建**。  
> **本阶段**：**A1｜领域模型与 IndexedDB Schema**（原 V2 方案的第二个执行步骤）。  
> **文档性质**：增量任务书；**不替代**项目根目录的 `PLAN.md`，不重新执行 A0。  
> **交付目标**：完成可靠的本地数据模型与仓储层，让后续 A2—D4 阶段能够直接复用。  
> **当前代码状态**：未附实际仓库，以下文件路径和数据库迁移只作为目标约束，Codex 必须先读取仓库并适配，不能假定项目为空。

---

## 1. 与 A0 的衔接

### 1.1 已完成内容（作为前置条件检查，不要重做）

- Vite + React + TypeScript strict 工程、基本路由及页面占位。
- 项目现有的依赖、格式化与测试工具、目录结构和 `docs/decisions.md`。
- 已存在的代码、IndexedDB 数据、测试和配置文件。

Codex 开始时，**只检查而不重复初始化**。如果 A0 的具体结果与原 V2 文档不同，以仓库实际情况为准；在交付说明中列出差异。若缺失 A1 必需的依赖或测试设置，可做最小范围修补，但不得借此整体重建工程。

### 1.2 本阶段明确不做

- 不导入完整莫扎特目录、不联网抓取 Open Opus/MusicBrainz、不生成虚构作品清单。
- 不开发作曲家卡片、作品列表、聆听弹窗、收藏页、统计图或热门作品 UI。
- 不实现 JSON 导出恢复界面；那属于 A5。
- 不添加用户账户、服务端、播放器、移动端或大型状态管理框架。
- 不清空数据库、不重置现有进度、不修改 A0 的路由布局（除确有编译修复需要）。

---

## 2. A1 验收目标

本阶段结束时应具备以下能力：

1. 能在 Dexie/IndexedDB 中**持久保存**作曲家、作品、编号、别名、作品聆听状态、完整聆听日期，以及未来收藏和公共标签所需的基本结构。
2. 聆听状态支持 `unheard / partial / completed`，**只有完整听过才算已听**；状态和日期是两个独立概念。
3. 可以将作品设为 `completed` 而**不填写日期**；删除最后一条日期也不会自动取消完成状态。
4. 将 `completed` 降为 `partial` 或 `unheard`，必须明确确认清除旧的完整聆听日期，并在同一数据库事务中完成；失败必须全部回滚。
5. 作曲家/作品的**内部稳定 ID**与 K./KV、Op.、BWV 等外部编号分离；同一作品允许多个编号。
6. 作品层级和是否计入统计可明确表达；合集、乐章不因是叶节点就自动算作独立作品。
7. 如果已有旧数据，必须**保留**并提供经过测试的非破坏性升级；否则只建立首个 schema 版本，不编造“迁移完成”。
8. 有可复现的自动化测试，且 `lint`、`typecheck`、`test`、`build` 全部通过。

---

## 3. 领域类型及不变量

### 3.1 核心枚举

```ts
export type ListeningStatus = 'unheard' | 'partial' | 'completed';
export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';
export type WorkNodeType = 'standalone' | 'collection' | 'movement' | 'excerpt' | 'part';
export type CountPolicy = 'countable' | 'container' | 'noncountable';
export type CatalogCoverage = 'sample' | 'partial' | 'verified';
export type PublicLabelType = 'popular' | 'source_recommended' | 'representative';
export type ReviewStatus = 'source_provided' | 'pending' | 'reviewed';
```

**注意**：`partial` 是“部分听过”，绝不是百分之多少；暂不追踪具体听过哪一乐章。

### 3.2 最小实体集

以下是逻辑模型，字段命名应尽量与根目录 `PLAN.md` 一致；若仓库已有对应类型，**在原类型上做兼容扩展**，不要平行创造两套模型。

| 表 | 必须支持的字段 | 关键约束 |
| --- | --- | --- |
| `composers` | `id`, `nameOriginal`, `nameZh?`, `birthYear?`, `deathYear?`, `era?`, `primaryCatalog?`, `coverageStatus` | 内部稳定 ID；目录覆盖度有明确标记 |
| `works` | `id`, `composerId`, `titleOriginal`, `titleZh?`, `parentWorkId?`, `nodeType`, `countPolicy`, `catalogStatus`, `isPerformable`, `primaryGenre?`, `key?` | `composerId` 必须存在；禁止父子循环；`isPerformable` 与是否有音源链接无关 |
| `work_identifiers` | `id`, `workId`, `system`, `value`, `normalizedValue`, `sortKey`, `isPrimary`, `edition?` | 编号不是作品主键；可多编号；至少能表示 `K. 551` |
| `work_aliases` | `id`, `workId`, `text`, `locale?`, `kind?` | 支持多语言/别名，不依赖名称作为 ID |
| `work_progress` | `workId`, `status`, `updatedAt` | 每个作品最多一条；无记录时视作 `unheard` |
| `listening_records` | `id`, `workId`, `datePrecision`, `dateValue`, `dateKey`, `createdAt`, `updatedAt` | 只属于 `completed`；`dateKey` 用来去重，见下文 |
| `composer_preferences` | `composerId`, `isFollowing`, `isFavorite`, `updatedAt` | 关注与喜欢独立；本阶段只有持久化模型，无页面 |
| `work_preferences` | `workId`, `isFavorite`, `isInQueue`, `updatedAt` | 喜欢、待听、聆听状态独立 |
| `work_public_labels` | `id`, `workId`, `labelType`, `sourceName`, `sourceId?`, `sourceUrl?`, `sourceDate?`, `reviewStatus`, `methodVersion?` | 允许同一标签多条来源证据；本阶段不抓取标签 |
| `source_mappings` | `id`, `entityType`, `internalId`, `sourceName`, `sourceId` | 预留跨源映射；不要用标题/目录号码直接覆盖内部 ID |
| `app_metadata` | `key`, `value` | 记录 schema 与数据版本/初始化标记，不能当作用户状态唯一真相 |

`catalogStatus` 至少能区分确定作品、归属存疑、佚失、残篇；若 A0 已有类型，先与既有类型对齐，并在 `docs/decisions.md` 说明纳入统计的默认规则。

### 3.3 日期精度与去重

```ts
// 可接受的语义形式：
{ datePrecision: 'year',    dateValue: '2019' }
{ datePrecision: 'month',   dateValue: '2019-06' }
{ datePrecision: 'day',     dateValue: '2019-06-15' }
{ datePrecision: 'unknown', dateValue: null }
```

- 年/月/日校验实际存在的日期（闰年、月份天数、格式），已知日期不能晚于**本地今天**。日期比较的“今天”通过参数/可替换时钟注入，以便稳定测试；不要直接把 UTC 日期切片当本地日期。
- **不补全精度**：`2019` 不能保存为 `2019-01-01`；`2019-06` 不能变成 `2019-06-01`。
- 默认标记“已听过但日期不详”**可以只有 `work_progress.status = completed`，没有任何 `listening_records`**；如果显式存储 `unknown` 记录，其 `dateValue` 必须是 `null`。
- 同一作品、同一日期精度、同一日期值的记录不可重复。建议额外生成唯一字符串 `dateKey`（例如 `year:2019`、`month:2019-06`、`day:2019-06-15`、`unknown`），在 IndexedDB 为 `[workId+dateKey]` 建唯一索引；这样不会因为 `null` 在 IndexedDB 中无法用作索引键而漏掉未知日期去重。
- 允许 `2019` 和 `2019-06-15` 同时存在，因为它们可能是两条用户输入的历史记录；年度统计未来应按作品去重，而不是按事件条数累加。

### 3.4 聆听进度不变量

1. 未存 `work_progress` 行时，读取接口返回 `unheard`（默认值），**不要猜测**某个作品已听过。
2. `completed` **允许零条日期**。
3. `unheard`、`partial` **不允许关联任何完整聆听记录**。
4. 从 `unheard`/`partial` → `completed` 可以只写状态，也可以在同一事务内写入一条已验证日期；服务/仓储层**不偷偷选择今天**，以后由 A4 的 UI 显式传入本地今天。
5. 从 `completed` → `partial`/`unheard` 需调用方显式传入“已确认清除历史”的意图；在单事务内删除该作品全部完整聆听记录并更新状态。没有确认则拒绝执行。
6. 已完成作品删除最后一条日期后，仍是 `completed`。
7. 作品状态切换不得修改 `composer_preferences`、`work_preferences`。
8. 外部作品编号改变不改变 `workId`；已有的聆听记录仍关联同一作品。

### 3.5 统计单位的最小纯函数（A1 仅做基础，不做图表）

定义并测试：

```ts
isEligibleWork(work): boolean
countCompletedUniqueWorks(works, progressByWorkId): number
```

最低规则：`countPolicy === 'countable'`、`isPerformable === true` 且 `catalogStatus` 属于经明确规则允许的状态才纳入。默认 `confirmed` 可纳入、`lost` 不纳入，存疑或残篇不能凭空自动纳入（如现有模型不同，记录决策）。按 `work.id` 去重。

必须满足：

- 贝多芬第九交响曲是 `countable`，乐章为 `noncountable`；整部 `partial` 计 **0**，整部 `completed` 计 **1**。
- 肖邦 Op.28 是 `container`，其独立前奏曲是 `countable`；完成其中 3 首计 **3**，容器额外计 **0**。
- `completed` 且日期不详仍计 **1**；记录同一作品多次不增加不同作品数。

> 本阶段不要求真的导入贝九或 Op.28；用**测试工厂中的小型假数据**验证规则，避免把示例数据写进用户数据库。

---

## 4. IndexedDB / Dexie 实现范围

### 4.1 Schema 与索引

复用 A0 已安装的 Dexie，按现有数据库版本**追加** schema，不允许删除原数据库并重建。索引建议如下（使用已有命名风格即可）：

- `works`：`composerId`、`parentWorkId`、`countPolicy`。
- `work_identifiers`：`workId`、`normalizedValue`；一个作品允许多个编号。
- `work_aliases`：`workId`。
- `work_progress`：`workId` 为主键/唯一。
- `listening_records`：`workId`，唯一 `[workId+dateKey]`。
- `composer_preferences`：`composerId` 为主键/唯一。
- `work_preferences`：`workId` 为主键/唯一。
- `work_public_labels`：`workId`、`labelType`、`[workId+labelType]` **非唯一**，允许不同来源共同证明一个标签。
- `source_mappings`：唯一 `[entityType+sourceName+sourceId]`（防止作曲家 ID 与作品 ID 偶然撞号）。

在应用仓储层验证作品与作曲家引用关系；Dexie/IndexedDB 没有 SQL 外键约束。不要实现自动级联删除真实用户聆听记录。

### 4.2 推荐仓储接口（可按仓库习惯微调）

```ts
interface CatalogRepository {
  getComposer(id: string): Promise<Composer | undefined>;
  putComposer(composer: Composer): Promise<void>;
  getWork(id: string): Promise<Work | undefined>;
  putWork(work: Work): Promise<void>;
  listWorksByComposer(composerId: string): Promise<Work[]>;
}

interface ListeningRepository {
  getStatus(workId: string): Promise<ListeningStatus>;
  getRecords(workId: string): Promise<ListeningRecord[]>;
  setStatus(
    workId: string,
    next: ListeningStatus,
    options?: { completedDate?: DateInput; confirmClearHistory?: boolean }
  ): Promise<void>;
  addRecord(workId: string, date: DateInput): Promise<ListeningRecord>;
  updateRecord(id: string, nextDate: DateInput): Promise<void>;
  deleteRecord(id: string): Promise<void>;
}
```

`DateInput` 是经校验的 `datePrecision` + `dateValue` 结构，不需要与界面表单类型耦合。上述接口是**行为契约**，不要求逐字照抄名称。补充 CRUD 最低限度的偏好/公共标签操作或类型化表访问，以便后续 B/C 阶段复用；但本阶段不写其 UI 业务。

**重要**：允许“修改已有记录”和“新增记录”分别操作；直接调用 `addRecord` 必须要求当前作品状态已是 `completed`（或统一提供事务性 `completeWithDate`），不能生成 `partial + 完整日期` 的矛盾状态。

### 4.3 迁移策略（条件执行）

开始前先报告数据库实际情况：

- **仅有 A0 空壳 / 不存在旧数据库**：建立初始 schema 版本和测试；不要写无必要的升级逻辑。
- **已有表但无真实用户数据**：增量升级 schema 和索引，保留已有作品主键。
- **已有旧 `isHeard` 字段或实际记录**：实施版本化、幂等迁移，且测试以下映射：

```text
isHeard === true  → completed
isHeard === false → unheard
```

旧 `isHeard=true` 即使没有日期，也必须变成 `completed`。已有日期保留其原始精度，不虚构日期；不能仅凭有日期推断 completed，也不能把数据库整体替换成测试样本。

升级前不得直接删除旧表或列。若发现超出上述模式的历史结构，先保护现有数据并在交付报告中明确阻塞点，不以猜测覆盖。升级失败应回滚并保留可恢复的原数据。

---

## 5. 测试（本阶段最重要的交付）

使用 A0 现有测试工具；如果对 IndexedDB 的自动化测试尚不支持，在**测试环境**添加 fake-indexeddb 或等效方案，不影响生产数据。测试使用独立数据库名，每例清理**测试数据库**，不能清空生产浏览器数据。

### 5.1 纯函数与日期校验

- `2019`、`2019-06`、`2019-06-15`、未知日期合法，展示/存储精度不丢失。
- `2019-02-29`、`2019-13`、格式不匹配、未来日期拒绝；`2020-02-29` 合法。
- `K. 551`、`K.9` 等编号可保留用于后续排序；A1 不要求实现完整自然排序（那属于 A2）。
- `partial` 不计数；`container` 与 `noncountable` 不计数；不同可计数作品按 ID 去重。

### 5.2 仓储与事务

- 持久化新增作曲家、作品，重新打开**测试数据库**后仍能读取。
- 不存在的 `workId` 不能写入悬空的进度、日期、收藏或标签；不能创建自指/循环父子关系。
- `unheard` → `completed`（无日期）有效。
- `unheard` → `completed`（带日期）在一次事务中写入两者；重复输入同一天同精度不会写入两条。
- `completed` → 删除全部日期：仍保持 `completed`。
- `completed` → `partial` 未确认：操作失败，原状态和全部日期原封不动。
- `completed` → `partial` 已确认：状态与日期同时更新；强制抛错时事务回滚。
- 收藏/待听字段与聆听状态独立，切换状态不会改变偏好。
- 同名作品有不同内部 ID，不会被合并；一作品有多个编号时聆听记录不重复。

### 5.3 兼容测试（仅已有旧结构时）

- `isHeard=true`、零日期升级后仍 `completed`。
- `isHeard=false` 升级后 `unheard`。
- 旧数据的作品内部 ID、聆听记录 ID 和日期保留；运行新 schema 第二次不会重复插入数据。
- 迁移失败不产生部分新状态/部分旧状态的混合损坏。

### 5.4 必须运行的检查

```bash
npm run lint
npm run typecheck  # 若 A0 采用不同名称，则运行等价命令并说明
npm run test
npm run build
```

若 A0 还配置了 `format:check`，一并执行。Playwright 在 A1 不强制新增业务 E2E；若有既存烟雾测试则应继续通过。

---

## 6. 建议修改文件范围（以实际仓库为准）

预计新增或修改：

```text
src/domain/types.ts                   # 核心枚举/实体
src/domain/listening.ts               # 状态、不变量、日期精度校验
src/domain/counting.ts                # 独立作品计数规则
src/db/database.ts                    # Dexie schema + 版本化升级
src/db/repositories/catalog.ts        # 作曲家与作品基础操作
src/db/repositories/listening.ts      # 日期和状态的事务操作
src/db/repositories/preferences.ts    # 仅最基本的持久化操作（或延至 B1）
src/domain/**/*.test.ts               # 纯函数测试
src/db/**/*.test.ts                   # IndexedDB / 迁移测试
docs/decisions.md                     # 只记录新增技术/业务决策
```

仓库已有相同职责文件则**修改现有文件**，不要为了匹配这份目录树额外复制一套。不要把 fixture 写入应用生产数据库；测试数据只放测试目录。不要在本阶段修改 `src/features/` 业务页面（除类型引用导致的最低限度修复）。

---

## 7. 可直接执行的任务序列

Codex 必须按顺序推进，**这一份计划内允许完成 A1 的全部子步骤，但不得越界到 A2**：

1. **A1.1 仓库差异检查**：阅读 `PLAN.md`、A0 交付记录、package scripts、现有 `src/domain`/`src/db`，列出现有实体和数据库版本。保留原有工程。
2. **A1.2 类型与纯函数**：先完成状态、作品层级、日期精度、计数资格的可测试模型。
3. **A1.3 数据库与索引**：新增或迁移 Dexie schema，加入必要的复合唯一索引与稳定主键。
4. **A1.4 仓储与事务**：实现最小 catalog / listening 仓储；确保编辑/删除日期与状态切换符合不变量。
5. **A1.5 迁移（仅有旧数据时）**：制作真实结构的迁移与测试，确保保留既有数据。
6. **A1.6 测试与收口**：执行测试、类型检查、lint、build；修复本阶段产生的失败，更新决策日志。

验收时不要求可视化展示完整目录，因为 A2 负责真实作品样本，A3 才负责列表展示。

---

## 8. 完成定义（全部满足才算 A1 完成）

- [ ] 没有重新初始化 A0 工程，也没有清空或覆盖任何已有用户数据。
- [ ] 所有必需实体、稳定 ID、索引和必要类型已实现，或已明确解释与现有模型等效的设计。
- [ ] 三种聆听状态与日期精度完整实现。
- [ ] `completed` 无日期合法，`partial` 不计入已听作品数。
- [ ] 作品层级/统计资格能表达贝九与肖邦 Op.28 的不同规则。
- [ ] 状态和日期的原子性及异常回滚有自动化测试。
- [ ] 已有旧数据时，升级测试覆盖 `isHeard` 迁移且没有数据丢失。
- [ ] 本阶段没有偷偷添加真实曲库数据、可视化页面、数据抓取或其他阶段功能。
- [ ] `lint`、`typecheck`、`test`、`build` 通过；失败项如实说明。
- [ ] 在 `docs/decisions.md` 记录必要差异与取舍，并给出按文件的改动摘要。

---

## 9. 交给 Codex 的执行指令（复制即可）

```text
当前古典音乐聆听档案项目已经完成 V2 开发路线的 A0 阶段。

请先阅读仓库根目录 PLAN.md、docs/decisions.md（如存在）、现有源码和测试，
再阅读本次提供的《A1 增量开发计划》，严格只执行 A1｜领域模型与 IndexedDB Schema。

本次是增量任务，绝对不要重新初始化项目、重做 A0、清空 IndexedDB、
替换已有代码结构，或提前实现 A2 的种子曲库和 A3/A4 的 UI。

优先复用仓库已有模块。先检查旧 DB schema 与数据迁移需求，
再实现领域类型、日期和状态不变量、Dexie schema、仓储事务及测试。

必须保证：
1. 完整听过才是 completed；partial 不计数。
2. completed 可无日期；删除最后一个日期不会自动恢复未听过。
3. 从 completed 降级时必须显式确认清除历史，并在事务内原子更新。
4. 稳定内部作品 ID 与作品编号分离；作品层级计数不重复。
5. 若有 isHeard 旧数据，版本化非破坏性迁移且保留 ID、日期和用户状态。
6. 保留 A0 的路由和工程配置，只做必要兼容改动。

完成后执行 lint、typecheck、test、build，必要时修复；
最后按下面格式汇报：
- A1 完成内容（对应验收清单）
- 新增/修改的文件
- schema 版本和迁移方案（如无旧数据写“无需迁移”）
- 执行的测试命令及结果
- 未解决风险与方案差异
- 下一阶段 A2 的前置条件

完成 A1 后停止，不要继续执行 A2，也不要替用户编造已通过的测试结果。
```

---

## 10. 下阶段衔接（仅说明，不执行）

**A2｜真实种子作品与目录编号** 将基于 A1 的仓储层导入少量经过校验的真实作曲家和作品、编号及别名，加入自然排序、规范化检索和幂等种子导入。当前 A1 只须保证模型能支持这些工作，不需要提前实施它们。
