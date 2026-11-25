# Web 云同步部署与使用

本实现面向 Web 浏览器，不包含桌面壳或 Android 应用。代码可打包部署，但仓库没有真实 CloudBase 环境，线上认证、上海地域资源可用性和大陆无代理网络尚未验收。不要将本地测试结果视为线上配置成功。

## 1. 创建环境与账户

1. 登录腾讯云 CloudBase 控制台，创建独立开发环境，选择中国大陆上海、PostgreSQL 模式。确认当前账号可开通 PG、云函数、认证和 HTTP 网关；如果不可用，先联系平台确认，不改用境外环境。
2. 核实套餐有效期、PG 计算/存储、云函数/网关调用与流量额度、暂停和续期规则，设置费用提醒。费用以控制台为准。
3. 在身份认证中开启邮箱密码登录，创建并激活个人账户；不需要公开注册页面。测试用独立账户，不把测试数据导入正式账户。
4. 将实际开发来源（例如 Vite 显示的 localhost 地址）和生产 HTTPS 来源加入安全来源，避免通配。记录环境 ID 与允许公开的 Publishable Key。

实现固定使用 `@cloudbase/js-sdk@3.11.0`。认证 API 以安装包类型与 [v3 认证文档](https://docs.cloudbase.net/api-reference/webv3/authentication) 为准；不要照 v4 Beta 示例改动。后端通过 [获取当前用户信息](https://docs.cloudbase.net/http-api/auth/user-me) 在线验证 Bearer token，只使用响应的 `sub` 和 ACTIVE 状态，忽略客户端提交的 UID。

## 2. 数据库与权限

在 PG 控制台取得云函数可访问的直连/连接池地址。连接使用 TLS 并验证证书；如需专用 CA，设置 PG_CA。具体地址和网络策略参考 [PG 连接说明](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)。

使用独立 migration 角色安装 SQL，使用另一个非表 owner、非 superuser、无 BYPASSRLS 的运行角色连接云函数。运行角色建议命名 `music_sync_runtime`，密码在控制台设置，不发送到聊天或提交 Git。

迁移文件：`server/migrations/001_sync.sql`。可以在控制台 SQL 编辑器中用 BEGIN/COMMIT 包裹执行；也可以在本地安全环境设置 migration 角色的 DATABASE_URL 后运行：

```sh
npm ci
npm run sync:migrate
```

脚本使用事务和迁移锁，已安装版本会跳过，不删除现有表。首次创建 `archive_sync` schema；如果存在同名非本应用结构，应先人工检查。服务端凭据只放在本地进程环境或云函数密钥配置中，脚本不打印连接字符串。

迁移完成后，用 migration 角色执行以下授权（运行角色须先在控制台创建）：

```sql
GRANT USAGE ON SCHEMA archive_sync TO music_sync_runtime;
GRANT SELECT, INSERT, UPDATE ON archive_sync.counters, archive_sync.entities TO music_sync_runtime;
GRANT SELECT, INSERT ON archive_sync.changes, archive_sync.operations TO music_sync_runtime;
```

客户端不直连这些表。所有四张表启用并强制 RLS；每个请求事务设置可信 UID，所有查询另有 owner_uid 条件。不要给运行角色 schema CREATE、删表或历史 DELETE 权限，不要把内部 schema 加到公开 REST schema 列表。管理角色只用于迁移。

## 3. 打包并部署云函数

```sh
npm run sync:build
```

输出 `dist-sync/index.js`（包含依赖）和 package.json，可将该目录内容打包上传。控制台创建 Node.js 22 或兼容更新版本的 **HTTP 云函数**，入口 `index.main`。代码使用 CloudBase HTTP 事件的 httpMethod、headers、body、isBase64Encoded 字段；部署后需要验证网关实际事件格式。

配置服务端环境变量：

| 名称             | 内容                                                           |
| ---------------- | -------------------------------------------------------------- |
| CLOUDBASE_ENV_ID | 与客户端相同的上海环境 ID                                      |
| DATABASE_URL     | 仅运行角色的 PostgreSQL 连接字符串                             |
| ALLOWED_ORIGINS  | 逗号分隔的 Web origin，如 https://你的域名；不含路径或结尾斜杠 |
| PG_CA            | 可选，PG 证书链 PEM；需要时设置                                |
| PG_SSL           | 云端保持未设置；仅隔离本地开发允许 disable                     |

云函数连接池最多 3 连接，按环境连接额度限制函数并发。网关配置请求大小不超过 1 MiB、合理请求频率和超时，并启用身份认证。CORS 的 OPTIONS 预检需要正常放行，真正 POST 仍必须认证。服务端有独立鉴权，不依赖可伪造的用户请求头。

取得真实 HTTPS 调用 URL；官方 HTTP 函数路径通常是 `https://<环境ID>.api.tcloudbasegateway.com/v1/functions/<函数名>?webfn=true`，以控制台提供的地址为准。参见 [HTTP 云函数调用](https://docs.cloudbase.net/cloud-function/function-calls/)。当前使用单一入口，JSON action 区分 status/push/pull，不要求额外创建五个路由。

本次没有安装 CloudBase CLI、创建资源或部署。可先按上述控制台步骤部署；如后续使用 CLI，应先固定实际 CLI 版本并检查该版本帮助，再记录适配本环境的部署配置。

## 4. 配置 Web

将 `.env.example` 复制为 `.env.local`，填写三个公开配置：

```dotenv
VITE_CLOUDBASE_ENV_ID=控制台的环境ID
VITE_CLOUDBASE_PUBLISHABLE_KEY=控制台的公开PublishableKey
VITE_SYNC_API_URL=控制台的完整HTTPS函数URL
```

`.env.local` 已忽略。任何数据库密码、管理 API Key、腾讯云 SecretKey 都不能放进 VITE_ 变量。

```sh
npm run dev
# 部署生产 Web 前：
npm run build
```

打开“数据与备份 → 云同步”，登录后点击“检查首次同步”。预览本地待上传项、云端记录数和估计冲突数。确认后自动保留一份完整 JSON 备份并绑定账户，可用“下载首次同步前备份”保存到其他位置，然后开始同步。

另一浏览器登录相同账号并执行首次同步，空本地档案会下载，不会删除云端数据。第一版手动同步；修改后点击“立即同步”。退出不会删除本地数据。绑定 A 的档案不能上传到 B；切换账户使用独立浏览器配置文件，避免混档。

## 5. 冲突与目录

冲突保留两端内容。可以保留本地、保留云端，或用日期/状态/收藏编辑表单手动解决，再点“立即同步”正式提交。若云端已再次改变，会继续检测并发。

公共作品按来源名称和来源 ID 映射，原本地主键不变。来源相同而本地主键不同的作品仍可匹配。缺少目录、未知来源及另一设备的手动作品会保存为待匹配记录，显示数量，不会丢弃或计入已完成统计。公共作品更新目录后点“重新匹配目录”。手动作品可通过原设备完整 JSON 备份迁移目录后匹配（注意现有恢复功能会替换本地业务档案，先导出备份）；自动同步手动作品描述尚未实现。

每个作品的状态、日期和收藏按一个原子实体传输，避免状态降级和历史删除只同步一半。不同日期 ID、不同偏好字段可三方合并；相同日期被不同 ID 重复创建时进入人工冲突，不静默删除事件。日期修改时间只用于保留资料，不参与“最新者覆盖”。

## 6. 排障与验收

| 现象               | 检查                                                 |
| ------------------ | ---------------------------------------------------- |
| 未配置             | 三个公开变量、重启 Vite/重新构建                     |
| 登录失败           | 环境、账户 ACTIVE、邮箱密码登录方式、安全来源        |
| HTTP 401           | token 过期/刷新失败；重新登录；检查认证接口是否可达  |
| HTTP 403 / CORS    | Web origin、安全来源、ALLOWED_ORIGINS、OPTIONS 路由  |
| HTTP 503           | 运行角色、TLS、连接池路径、SQL migration、环境变量   |
| 已上传但响应丢失   | 直接重试；原 operationId 保留，服务器幂等返回        |
| 待匹配目录         | 更新目录或迁移手动作品，重试匹配；云端内容已持久保存 |
| 另一标签页正在同步 | 等待其完成；Web Locks 在关闭标签页后自动释放         |
| 请求过大           | 单作品上限 1 MiB；本地数据保留，不会显示成功         |

使用支持 Web Locks、IndexedDB、crypto.randomUUID 的现代浏览器，在 HTTPS 或 localhost 下运行。不要清除站点数据处理同步故障。云同步不能代替 JSON 备份。

验收命令：

```sh
npm test
npm run sync:test
npm run lint
npm run build
npm run sync:build
npm run test:e2e
```

`sync:test` 会在系统临时目录创建真正的 PostgreSQL，端口绑定本机，运行完成删除测试库；需要允许本机监听以及 embedded-postgres 平台包的 symlink 初始化，不使用任何 CloudBase 或正式数据库。身份接口的单元测试使用明确的测试替身，不代表真实登录已通过。

上线前必须另做：真实账户受保护 API、未登录拒绝、两个独立测试账户隔离、两浏览器双向编辑与冲突、离线重试，以及中国大陆宽带/移动网络在关闭代理后的登录/上传/下载。记录日期、浏览器和网络类型。当前尚未执行这些线上步骤。
