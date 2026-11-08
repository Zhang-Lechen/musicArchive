# 离线目录工具

所有命令从项目根目录运行。普通用户打开应用时不请求第三方 API。

```sh
npm run catalog:check
npm run catalog:build
npm run seed:build
```

- `catalog:check` 从已有快照规范化、去重和校验，只写 dry-run 报告，不修改应用目录文件或用户 IndexedDB。
- `catalog:build` 重放快照，生成确定性的规范化 JSON 与校验/复核报告。
- `seed:build` 从规范化目录选取固定 18 部真实示例，12 部莫扎特核心作品与 6 部其他作曲家作品。

需要联网更新原始快照时：

```sh
npm run catalog:fetch
```

该命令依次获取 Open Opus 的 10 个时期作曲家列表与每位作曲家的作品列表，限速至每次请求至少间隔 1.1 秒；超时 20 秒，最多 3 次尝试，按退避及 429 Retry-After 重试。任意请求最终失败时退出码非零并写错误报告，已有规范化应用目录不会被半份输出覆盖。

也可以只获取首批作曲家、指定输入/输出路径或生成其他报告：

```sh
npx tsx scripts/catalog.ts --fetch --names Mozart,Beethoven,Bach --input scripts/sources/subset.json --output work/subset.json --report work/subset-report.json
npx tsx scripts/catalog.ts --input scripts/sources/snapshot.json --dry-run --report work/review.json
```

读取 `docs/data-sources.md` 确认数据许可与审校边界。原始快照包含获取时间、CC0 许可、真实实体 ID；输出报告包含输入 SHA-256、条目数、去重及人工复核项。不得把条目数解释为目录完整性。

在应用“数据与备份 → 更新作品目录”中选择生成的目录 JSON，先看匹配/新增预览，再确认写入。来源映射或编号歧义会拒绝导入，个人记录不会被替换。此导入与“从备份恢复”的整份替换是两个独立入口。

发布新的内置数据版本时，先复核报告、重新生成种子，再递增 `src/services/catalog.ts` 中的 `bundledCatalogVersion`。schema 改动另行添加 Dexie 显式迁移，禁止改写已发布 v1 定义。测试中包括重放幂等、种子升级和来源合并保留个人档案。
