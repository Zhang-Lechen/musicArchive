# A1 增量交付记录

日期：2026-11-04。

## 已完成

- 复用现有工程、领域文件、Dexie 与测试工具，不重新执行 A0。
- 领域模型支持 unheard / partial / completed，四种日期精度，作品层级、统计策略、可演奏性、偏好与带来源的公共标签。
- 核心 API：getStatus / getRecords / setStatus / addRecord / updateRecord / deleteRecord；catalog 写入支持稳定 ID、多编号、多语言别名和层级引用校验。
- completed 可无日期；删除最后一条日期保留完成状态；降级要求确认，并在单事务内清空完整日期。正常完成与异常回滚均有测试。
- 本地日期时钟可注入，不补全年/月精度；unknown 使用非空 dateKey 参与数据库唯一约束。
- 统计只计算 confirmed、countable、可演奏且 completed 的独立 work.id。贝九与 Op.28 的差异通过测试 fixture 验证，未写入生产曲库。
- composer_preferences / work_preferences / work_public_labels 有类型化访问和验证引用的写入方法，偏好独立于聆听状态。

## 文件摘要

| 文件                                       | 改动                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| src/domain/types.ts                        | 兼容扩展枚举、实体、Work 规范化及旧 isHeard 投影；备份 v2 类型                   |
| src/domain/dates.ts                        | 日期去重键与防御性精度校验，复用已有本地日期逻辑                                 |
| src/domain/counting.ts（新增）             | isEligibleWork / countCompletedUniqueWorks                                       |
| src/domain/dates.test.ts                   | 日期合法性、精度、闰年和注入今天的边界                                           |
| src/domain/counting.test.ts（新增）        | 贝九、Op.28、ID 去重、目录统计排除规则                                           |
| src/db/database.ts                         | 保留 v1，追加 v2 表、索引、原子迁移与 schemaVersion 元数据                       |
| src/db/repository.ts                       | 三态/日期事务、catalog 基础读写、父子引用检查、偏好与公共标签写入；保留旧 UI API |
| src/db/repository.test.ts                  | 原重置用例显式传入确认，保留既有测试                                             |
| src/db/migration.test.ts                   | 用真实 v1 fixture 替代原迁移示意测试，覆盖升级、幂等和失败恢复                   |
| src/db/a1.test.ts（新增）                  | 新仓储契约、悬空引用、循环、时钟、偏好独立性及唯一索引                           |
| src/services/validation.ts                 | 复用已有 Zod 校验，规范化旧模型，校验三态、日期键、偏好和标签                    |
| src/services/backup.ts                     | 现有备份的 v2 数据兼容，保留新增表并在事务中恢复                                 |
| src/services/backup.test.ts                | v1/v2 兼容、新表往返、冲突拒绝与恢复回滚                                         |
| src/services/catalog.ts                    | 元数据合并时保留用户作品新增结构字段；复用统一统计资格规则                       |
| src/features/listening/ListeningDialog.tsx | 原有确认成功后显式传 confirmClearHistory，无新增界面                             |
| src/app/routes.test.tsx                    | 原重置测试适配显式确认                                                           |
| .prettierignore                            | 外部增量计划与已有原始方案一样排除自动格式化                                     |
| docs/decisions.md                          | 仓库差异、默认规则、升级策略与兼容取舍                                           |
| docs/a1-delivery.md（新增）                | 本交付记录                                                                       |

## Schema 与迁移

数据库名不变：classical-listening-archive。版本 1 → 2。

- 新增三张偏好/标签表；新增作品 countPolicy 索引；日期唯一索引改为 [workId+dateKey]。
- 保留原有来源索引 [sourceName+entityType+sourceId]，与计划建议顺序不同但唯一性语义等效。
- isHeard=true 映射 completed，即使没有日期；false 映射 unheard。保留全部作品/记录 ID、日期值与精度、时间戳和旧表字段。
- 升级只执行一次，再打开不重复插入。重复 unknown、矛盾日期或状态等异常导致整个升级回滚，旧 v1 库仍可打开；不丢弃旧记录来强行完成升级。
- 测试使用 fake-indexeddb 和独立测试库，未访问用户浏览器档案。实际用户库的存在与内容无法由源码判断，未声称已迁移用户真实数据。

## 验证

| 命令                 | 结果                              |
| -------------------- | --------------------------------- |
| npm run lint         | 通过                              |
| npm run typecheck    | 通过                              |
| npm run test         | 通过，10 个文件、76 项测试        |
| npm run build        | 通过                              |
| npm run format:check | 通过                              |
| npm run test:e2e     | 通过，12 项（完整重跑，2.2 分钟） |

## 风险、差异与 A2 前置条件

- 仓库已有远超 A0 的目录、页面与备份。本轮未新增曲库或 UI 功能；备份仅作新增模型的必要兼容修复。原始方案和本次计划正文未修改。
- 为兼容旧目录和现有调用，Work 新增结构字段在 TypeScript 输入类型中可选，正常持久化入口与升级均会补全。isHeard 保留作旧界面的完成状态投影；partial 尚无专用界面，这属于后续 UI 阶段。
- 备份导出格式为 2，可读取原格式 1；旧版应用不能读取新格式。回退应用版本前应保留旧备份。
- 异常旧库升级会安全失败，需用旧版本先导出并人工复核。本轮没有发现可访问的真实用户库，不对其内容作推断。
- 首轮 E2E 暴露冷启动生命周期超出总预算与既有目录合并的重复全表扫描；针对性调整一个总预算并消除重复扫描，保留所有业务及逐项断言；完整重跑 12 项全部通过，3000 条用例耗时 10.8 秒，重启持久化用例耗时 14.2 秒。
- 当前目录无 .git，因此无法生成 Git diff 或提交；文件级摘要如上。
- A2 可复用仓储、稳定 ID、编号/别名表和来源映射。开始前应先核对现有种子及目录管道，避免重复导入；导入时明确作品结构和统计策略，禁止覆盖个人进度。本轮已停在 A1，未执行 A2。
