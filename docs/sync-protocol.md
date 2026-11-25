# 同步协议 v1 与实现边界

入口：HTTPS POST，Authorization: Bearer token，Content-Type: application/json。仅个人数据；公共目录不上传。

请求统一携带 protocolVersion: 1。未知协议、未知业务字段、非法日期拒绝写入，旧客户端不会抹去未来字段。

- status：`{protocolVersion:1, action:"status"}`，返回协议和非删除实体数量。
- push：`{protocolVersion:1, action:"push", operation:{operationId,deviceId,key,baseRevision,payload}}`。返回 `{operationId, conflict, remote}`。
- pull：`{protocolVersion:1, action:"pull", cursor:"0", limit:200}`，返回 `{changes,cursor,hasMore}`。

revision 与 seq/cursor 是十进制字符串，客户端使用任意精度整数比较。key 是 JSON 编码的三元素数组 `[kind,namespace,sourceId]`：kind 为 work/composer，公共来源通常是 Open Opus，无来源使用 archive-local 与原 UUID。按来源映射，不按名称自动合并。

work payload 包含 kind、展示 title、三态 status、favorite、queued、following（作品应为 false）和 records。records 是事件 ID 到日期精度/日期值/可选原始时间戳的映射。composer 使用 favorite/following，空 records、unheard、queued=false。精确 schema 见 `src/sync/protocol.ts`，Android 可实现同一 JSON 校验。

每个作品是原子同步单位，一次提交可含状态改变和相关日期删除。records 中基线有而新值无的 ID 表示删除；实体 payload=null 表示实体 tombstone。历史 changes 保留完整版本，故删除事件不会因未上传整库而丢失。相同实体内独立字段与独立日期 ID 三方合并；删除/修改及领域不一致进入冲突。相同日期不同 ID 不自动选赢家。

服务端事务由用户计数器行锁排序，计数器、实体、历史、幂等结果同事务提交。operationId 以 owner_uid 隔离；内容摘要不同拒绝，内容相同重复返回确定结果。原始 baseRevision 对应服务端保存的历史值，不信任客户端提交的 base payload。未知/未来基线拒绝。过期历史基线返回 BASE_REVISION_EXPIRED；v1 不裁剪历史或 tombstone，因此正常运行没有游标过期。未来添加历史清理前必须实现一致快照及游标重建，当前禁止直接清历史。

首次同步由只读分页预览、完整本地备份、账号绑定、上传和拉取构成；未登录也追踪本地变更。队列对未发出的同实体编辑合并保存最新 desired，发送前持久化不可变 operation；发送后继续编辑仍保留最新 desired，确认响应后重新基于已接受版本提交。业务写入和 desired 同一 Dexie 事务，远端应用和 cursor 同一事务。一个实体不会出现一半状态、一半日期。

冲突解决复用 Push：基于冲突的远端 revision 生成新操作并提交，不单独提供 resolve HTTP action。选择保留云端也会执行版本检查。正在发送的请求 ID 不改变。离线/网络失败保留原操作，用户重试；不做无限自动重试。

未知目录记录与原始远端数据保存至 sync_entities.unresolved，游标推进只发生在整页全部业务或暂存内容持久保存后。重新匹配前不虚构作品、不推算统计。相同账号不同设备不同步 deviceId、凭证、游标或首次备份。

当前限制：每请求一个作品/作曲家实体，最多 1 MiB；每次 Pull 最多 200 实体版本；不自动同步、不开公开注册、不管理设备列表；手动作品描述暂不自动传输，可保留待匹配数据。浏览器内互斥依赖 Web Locks。没有桌面壳、原生 Android 或云端推送依赖。

服务器表按原子实体统一存放于 archive_sync.entities，替代最初方案的四张独立业务表；changes/operations/counters 为审计及同步内部表。逻辑业务字段仍分别校验。所有表 RLS 按 owner_uid 隔离，前端无直接表权限。
