# 跨平台同步阶段 1：环境和数据库调查

调查日期：2026-11-14（Asia/Shanghai）。依据：`plans/sync-plan.md` v1.0。

状态：仓库调查和接入设计完成；真实 CloudBase 环境、账号及桌面客户端尚未验证。依方案第二十节，本阶段结束后等待用户验收，不实施阶段 2—7。未读取或修改浏览器正式个人数据库，未创建云资源，未安装新依赖。

## 1. 当前环境与范围

- React 19.3.1、TypeScript 5.9.3、Vite 8.3.5、Dexie 4.4.7、Zod 4.6.7；本机 Node 26.13.1，符合 package.json engines。
- 当前是 Web 应用，包含离线资源插件 `scripts/offline-plugin.ts`；没有 Tauri、Electron、Rust 或原生 Android 工程。不能将现有浏览器测试称为 Mac/Windows 桌面客户端验收。
- 本地数据库 `classical-listening-archive`，Dexie schema v2；JSON 备份格式 v2，兼容读取 v1。数据库版本、备份版本、目录版本应继续独立管理。
- 公共目录版本 `2026.11.04.1`。目录入口 `CatalogProvider` 仅提供公共目录，个人同步需独立服务。
- 仓库没有 CloudBase SDK、云函数、SQL migration 或同步配置。当前没有可用于真实联调的已确认环境 ID、网关地址、账户或数据库连接。

## 2. 实际同步数据模型

| 本地表                                                                         | 主键及业务字段                                                           | 同步策略                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| work_progress                                                                  | workId；status、isHeard、updatedAt                                       | 同步三态；isHeard 仅为 completed 投影                |
| listening_records                                                              | UUID id；workId、datePrecision、dateValue、dateKey、createdAt、updatedAt | 独立事件及删除；日期精度含 unknown/null              |
| composer_preferences                                                           | composerId；isFollowing、isFavorite、updatedAt                           | 同步关注和喜欢，false 也是有效变更                   |
| work_preferences                                                               | workId；isFavorite、isInQueue、updatedAt                                 | 同步喜欢和待听，不能过滤掉取消操作                   |
| works 等手动补录行                                                             | userCreated、UUID、作品编号、别名、父子关系                              | 作为用户作品描述随引用保留；缺失目录不能丢弃个人记录 |
| composers / works / work_identifiers / work_aliases / source_mappings 的公共行 | 公共目录及来源映射                                                       | 不纳入日常全量上传；来源映射用于稳定引用             |
| work_public_labels                                                             | popular / source_recommended / representative 及来源                     | 公共标签，不属于个人收藏，不同步                     |
| app_metadata                                                                   | initialized、seedVersion、catalogVersion、restoredAt 等                  | 设备状态不跨设备覆盖；账号绑定与游标新增专用表       |

没有已实现的个人笔记或个人标签模型；聆听记录没有 partial 属性。不能为了同步虚构这些字段。

领域约束：历史日期只能属于 completed 作品；从 completed 改为 partial/unheard 必须确认并清除历史；删除最后一个日期仍保留 completed。统计依赖作品 countPolicy、可演奏性、确认状态及明确的 completed，不能按日期数推断。

## 3. 作品稳定 ID

`scripts/catalog-core.ts` 的 stableId 对固定 Open Opus 来源、实体类型、来源 ID 做确定性 SHA-256 映射；同一来源 ID 重建目录不会随机换主键。但这不是所有设备主键必然相同的保证：

1. `planCatalogMerge` 会把新目录映射到已有作品并保留已有内部 ID；旧种子与手动补录可能采用不同 ID。
2. `addManualWork` 使用 randomUUID；两台设备分别补录同一作品会产生不同 ID。
3. source_mappings 已有来源名称、来源 ID、内部 ID，可作为跨目录桥梁；编号和名称不能单独成为同步主键。

设计：公共作品使用 `{catalogNamespace: 'openopus', canonicalWorkId: sourceId, catalogVersion}`，本地另存 canonical reference → localWorkId 映射，作曲家同理；不重写原主键。无来源的用户作品用独立命名空间与持久 UUID，并保留最小作品描述、编号及父级引用。映射不唯一时人工确认，不按标题猜测。未知作品或作曲家的远端原始记录进入 unresolved 表，允许游标在完整持久保存该页后推进，目录更新后重新匹配。

## 4. 全部写入路径与风险

| 入口                                                         | 当前行为                              | 后续改造                                                                           |
| ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------- |
| repository.mutate、setHeard、setStatus、resetUnheard         | 事务内修改状态/批量/日期              | 最外层事务计算前后差异并写 outbox；嵌套 mutate 不重复记日志                        |
| addRecord、updateRecord、saveRecord、deleteRecord            | 日期新增、更新、删除                  | 对记录 ID 生成 upsert/delete；保持原 ID 和日期约束                                 |
| undo                                                         | 检查快照后删除重建记录                | 按事务净差异生成新操作，不能抹去已提交历史                                         |
| put/setComposerPreference、put/setWorkPreference             | 各自事务或整行覆盖                    | 同事务日志；明确字段变化，避免未改字段覆盖                                         |
| addManualWork、putWork、putComposer、putIdentifier、putAlias | 创建/修改目录实体                     | 区分用户描述与公共目录；用户描述变更可追踪                                         |
| restoreBackup                                                | 遍历 database.tables 清空全部表再恢复 | 必须改为业务表白名单；保留设备身份、归属、基线；确认后按差异生成恢复操作及删除事件 |
| importCatalog、initializeSeed                                | 使用全表事务导入公共目录              | 不产生公共数据 outbox；更新映射并重试未匹配数据                                    |

恢复前已有 validateBackup 会合并相同作品/日期/精度的重复记录。同步不能复用这种过滤来静默丢弃不同事件 ID：跨设备同日不同 UUID 应显式记录去重映射或进入冲突，且保留原始事件和后续删除关联。

同一作品的状态降级与另一设备新增完整日期，虽然实体 ID 不同，仍构成领域冲突。设计采用操作组（mutationId），服务端按组检查作品状态与日期约束、原子提交；Pull 不拆开操作组应用。冲突组完整暂存，不将半组数据写入业务表。

## 5. 非破坏性本地迁移设计（阶段 3）

追加 version(3)，不修改已发布 v1/v2，不清库。保留全部业务行及主键，新增：

- sync_device：稳定随机设备 ID，不随退出或恢复旧备份变化。
- sync_accounts：本地档案绑定 ownerUid、首次同步状态、cursor、lastSuccess；不存密码。
- sync_outbox：operationId、mutationId、deviceId、实体引用、payload/schemaVersion、baseRevision、状态、创建时间；索引账户/状态和实体。
- sync_entities：账户+实体的云端 revision、基线快照及 tombstone。
- sync_conflicts：本地/远端值、版本、设备、冲突字段及原始操作。
- sync_unresolved：完整远端内容、序号、引用及未匹配原因。
- sync_references：跨设备规范引用与本地主键映射。
- sync_backups：首次同步前完整业务备份；不包含密码/token。

迁移只建表及元数据，不将已有行直接当作删除或默认上传。首次绑定前导出、校验、预览三种 bootstrap 情形；既有数据入队与绑定在事务内完成。新增表失败应由 IndexedDB 升级事务回滚。

所有本地业务事务纳入 outbox、版本表；禁止网络 await 混入 Dexie 写事务。远端应用标识来源，不再生成本地回声操作。跨标签页使用持久租约/锁保证单设备同步互斥，并处理崩溃后的租约恢复。正在发送的操作内容不可改写，后续编辑使用新 ID 并等待前项结果确定基线。

退出保留数据和绑定。第一版阻止将绑定 A 的档案自动上传到 B；切换需明确隔离档案/备份迁移流程，不能仅清 token 后复用 A 的队列。设备标识、凭证和活跃游标不随跨设备 JSON 恢复转移。

## 6. CloudBase 核实与接入设计

2026-11-14 只读查询 npm 官方 registry：`@cloudbase/js-sdk` latest 为 **3.11.0**，beta 为 **4.1.0-beta.2**；仓库尚未安装。暂定阶段 2 固定 3.11.0 并提交 lockfile，不能混用 v2/v3/v4 示例。查询最初因受限 DNS 失败，开放该只读请求后成功；这不属于国内无代理验证。

官方 v3 文档支持邮箱密码 `signInWithPassword`、会话获取/刷新及退出；v4 仍标为 Beta，认证接口有变化。认证适配器只暴露账户、访问令牌获取及会话事件，核心协议不依赖 SDK。[v3 认证](https://docs.cloudbase.net/api-reference/webv3/authentication)、[版本迁移](https://docs.cloudbase.net/api-reference/webv4/migration)。

官方提供 PG 模式，支持 PostgreSQL 协议连接；事务写入拟在 Node 云函数内使用 pg 连接池，前端只走同步 API，不直写表。实际连接地址、TLS、网络可达性与连接池额度必须在目标环境验证。[PG 初始化](https://docs.cloudbase.net/database/postgresql/initialization)、[连接方式](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)。

HTTP 云函数可以通过官方网关携带 Bearer access token 调用；web 函数需 webfn=true。方案的 /api/sync/* 为逻辑路径，部署时映射到网关路由或函数内 dispatcher。网关鉴权之外，服务端必须获取已验证用户身份；不得相信请求体 UID、普通身份头或仅解码未验签 JWT。阶段 2 用真实 token 验证可信上下文来源，必要时调用官方用户验证接口，验证失败拒绝执行。[HTTP 调用](https://docs.cloudbase.net/cloud-function/function-calls/)、[网关认证](https://docs.cloudbase.net/service/authentication)。

Web/Vite 接入从架构上可行，但未安装 SDK，不能声称构建兼容测试通过。没有桌面壳，Tauri 的 macOS WebView、Windows WebView2、来源许可、持久化及刷新需单独验证。阶段 7 若要求独立桌面包，需增加 Tauri 工程并进行真实打包，而不是仅用 Web 测试代替。Android 保留纯 HTTPS JSON 协议即可。

上海是目标地域，不代表本账户必有可购的 PG 套餐。须在创建页面确认 PG、认证、云函数、网关同时可用及费用；不能擅自改为境外地域。具体价格、资源点、免费期限、暂停行为以当前控制台为准。[环境创建](https://docs.cloudbase.net/quick-start/create-env)、[PG 计费说明](https://docs.cloudbase.net/database/postgresql/database-management)。

## 7. 云端逻辑模型及一致性

| 表                                      | 主键 / 约束              | 内容                                     |
| --------------------------------------- | ------------------------ | ---------------------------------------- |
| user_work_states                        | owner_uid + entity_id    | 三态与独立 revision                      |
| listening_records                       | owner_uid + entity_id    | UUID 事件、规范作品引用、日期字段        |
| composer_preferences / work_preferences | owner_uid + entity_id    | 偏好布尔值及版本                         |
| user_work_descriptors                   | owner_uid + entity_id    | 仅手动作品及必要引用描述                 |
| sync_counters                           | owner_uid                | 最后提交 serverSeq、历史保留水位         |
| sync_changes                            | owner_uid + server_seq   | 操作组、实体、版本、payload/删除标记     |
| sync_operations                         | owner_uid + operation_id | 规范请求摘要、确定结果；同 ID 异内容拒绝 |
| sync_conflicts                          | owner_uid + conflict_id  | 冲突内容、基线、解决结果                 |
| device_registry                         | owner_uid + device_id    | 设备名、最后同步状态                     |

业务行包含 business_payload、payload_schema_version、revision、is_deleted、服务端时间。数据库 revision/seq 用 bigint，协议中拟使用十进制字符串避免 Android/JS 数字精度差异；方案数字示例不作为固定 JSON 类型。

事务顺序：认证和 schema 校验 → 用户计数器行锁 → 幂等摘要核对 → 版本及操作组领域校验 → 修改业务行/删除标记 → 分配序号 → 写 changes 和确定操作结果 → 提交。并发冲突也需有可重复读取结果，解决时提交新 operationId 和当前云端 revision；再次并发仍返回冲突。禁止单纯按时间覆盖。

内部表置于不对客户端暴露的 schema；撤销 PUBLIC/anon/authenticated 的不必要权限。migration 角色和函数运行角色分离；运行角色非 owner、非 BYPASSRLS，按已验证 UID 设置事务级上下文并配合 RLS；所有查询显式 owner_uid 过滤。若暴露业务表，另行验证 GRANT + RLS，不能假定数据库直连会自动带 auth.uid()。

Pull 按用户序号、操作组分页，应用业务数据/未匹配或冲突暂存与游标同事务。Bootstrap 使用一致快照及水位，保留本地待提交修改；游标过期返回明确错误，重建快照基线，不能清空 outbox。删除标记与操作幂等结果的清理策略必须配合设备水位；初版保留，不做不安全自动裁剪。旧 payload 版本拒绝未知破坏性覆盖，保留未知字段，重大不兼容提示升级。

接口限制拟为每次最多 100 操作、请求最多 1 MiB、Pull 默认 200 条并限制组大小；均为待实现配置，需测试大批量恢复拆组与单作品原子性。同步状态只有云端已确认且本地完成写入后才显示成功。

## 8. 后续实施文件清单

以下均为计划，尚未创建实现：

| 阶段 | 文件                                                                                                                               | 内容                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 2    | server/package.json、server/src/auth.ts、db.ts、handler.ts；server/migrations/001_sync.sql；cloudbaserc.json                       | 固定服务端依赖、鉴权、SQL、网关部署与真实账号探针  |
| 2    | .env.example、.gitignore、docs/cloudbase-setup.md                                                                                  | 配置模板、忽略秘密、部署命令和角色安全检查         |
| 3    | src/db/database.ts、repository.ts；src/services/backup.ts、validation.ts、catalog.ts；src/sync/local-store.ts、references.ts       | v3、所有入口原子日志、备份与映射                   |
| 4    | shared/sync-protocol.ts；src/sync/engine.ts、transport.ts、bootstrap.ts；server/src/sync-service.ts                                | schema、Push/Pull/Bootstrap、分页、幂等与重试      |
| 5    | src/sync/conflicts.ts；server/src/resolve.ts；src/features/sync/ConflictDialog.tsx                                                 | 保留本地/云端/手动编辑及再次冲突                   |
| 6    | src/sync/auth.ts；src/features/sync/SyncPanel.tsx、BootstrapDialog.tsx；src/features/composers/DataManager.tsx、src/app/styles.css | 登录、归属提示、同步状态、首次备份确认             |
| 7    | src/sync/*.test.ts、server/tests/、tests/e2e/cloud-sync.spec.ts、src/db/migration.test.ts；src-tauri/                              | 模型/协议/真实 PG 权限/双端/迁移；桌面壳及实机验证 |
| 7    | docs/sync-protocol.md、sync-operations.md、sync-acceptance.md、android-sync.md                                                     | 协议、排障、证据矩阵、Android 接入                 |

## 9. 用户控制台配置清单

阶段 1 验收后按顺序进行：

1. 登录腾讯云 CloudBase，创建独立开发环境，选择中国大陆上海和 PostgreSQL 模式；若选项不可用，记录限制并先解决，不选文档型数据库替代。
2. 确认套餐包含 PG、云函数、HTTP 网关、认证；记录有效期、计算/存储/流量/请求额度、超额规则和暂停/续费机制，设置费用提醒。
3. 在身份认证中开启邮箱密码对应的登录方式，创建/激活个人测试账户；关闭不需要的公开注册。密码只在控制台或应用输入。
4. 配置真实开发和生产 Web 来源（以实际启动 URL/端口为准），不使用任意来源通配；桌面来源待 Tauri 实测后添加。
5. 记录环境 ID、地域、允许公开的 Publishable Key，以及实际网关 URL。这些是后续接入需要的公开配置，不包含管理员密钥。
6. 在 PG 控制台确认连接池/直连地址、TLS 与云函数网络路径。数据库密码仅写云函数密钥/环境配置；migration 与运行角色分离。
7. 阶段 2 代码准备后执行版本化 SQL、部署函数、开启网关鉴权和严格 CORS。先验证匿名/过期 token 拒绝、A/B 测试账户隔离，再验证真实账号受保护调用；正式账户不写测试数据。
8. 分别在大陆宽带与移动网络关闭代理后记录登录、上传、下载结果；Windows/macOS 分别记录系统/WebView 版本。不能用当前开发环境结果替代。

拟定公开变量：VITE_CLOUDBASE_ENV_ID、VITE_CLOUDBASE_PUBLISHABLE_KEY、VITE_SYNC_API_BASE_URL；服务端变量：DATABASE_URL、认证环境配置、ALLOWED_ORIGINS。DATABASE_URL 和所有管理密钥绝不可使用 VITE_ 前缀，不要发送到聊天或提交 Git。

CLI 优先用于可复现部署，但当前未安装/验证 CLI，也没有环境配置；阶段 2 固定 CLI 版本后先核对 help，再交付 login、函数部署、迁移的确切命令，当前不提供猜测命令或伪造环境值。

## 10. 本次检查与验收边界

- `npm test`：13 个测试文件、96 个测试通过（fake-indexeddb/jsdom 隔离测试，不操作正式浏览器数据库）。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `npm run lint`：通过。
- npm 官方 registry 版本查询成功；仅核实发布版本，未安装或调用 SDK。
- 本次仅新增计划和调查文档，不修改业务代码、package-lock 或数据库 schema。
- 未执行真实 CloudBase 登录/PG 事务/权限、T01—T20 同步验收、Windows/Mac 原生客户端及大陆网络测试；这些是后续阶段明确的验收门槛。

下一阶段开始条件：用户验收本调查，确认上海 PG 环境及套餐可用，提供公开接入配置，并在本地/控制台安全配置服务端连接。阶段 2 的通过标准仍为真实个人账号的受保护 API 调用，不能用 mock 代替。
