# 目录来源、许可与审校边界

## 当前数据快照

获取日期：2026-11-04（Asia/Shanghai；JSON 时间戳使用 ISO UTC）。

- 来源：Open Opus 公开 API，220 位作曲家、25,195 条作品。包括莫扎特、贝多芬、巴赫、海顿、舒伯特、维瓦尔第、肖邦等。
- 通过文档列出的 10 个音乐时期端点获取真实作曲家 ID，再逐一获取作品 ID；每次请求间隔至少 1.1 秒，失败最多尝试 3 次，支持退避与 HTTP 429 Retry-After。
- 原始响应字段快照：`scripts/sources/snapshot.json`。文件只保留目录所需字段，不下载肖像、录音或乐谱。
- 规范化目录：`src/data/catalog.json`。`docs/catalog-report.json` 记录输入 SHA-256、生成时间、条目数、错误、去重与复核项。
- 数据获取没有出现重试错误。全部作曲家覆盖状态为 `partial`；没有任何作曲家被标为 `verified`。

Open Opus 的项目 README 明确区分 [API 代码 GPL v3 与元数据 CC0](https://github.com/openopus-org/openopus_api#license)。本项目只使用 CC0 元数据，没有复制其 PHP/API 实现、网站代码、图片或音频。许可链接：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。接口说明：[USAGE.md](https://github.com/openopus-org/openopus_api/blob/master/USAGE.md)。

## 内部 ID 与反复导入

离线规范化使用项目命名空间和真实来源实体 ID 生成固定内部 UUID，来源 ID 另外保存在 `source_mappings`。作品名、编号、别名变动不会重新生成内部 ID。

应用合并目录时优先解析现有来源映射，然后检查内部 ID，最后以同作曲家下无歧义的编号关联手动补录。名称本身不会触发静默合并；同名、映射冲突、多作品共号等情况会明确拒绝写入，要求复核。目录更新不触碰个人进度与聆听表。用户已听过作品不会因上游层级或佚失状态变更而自动失去档案。

全量来源信息在作曲家的 source 中保存；每个作品都有独立来源 ID 映射与时间。作品弹窗继承作曲家来源。源未提供的作品中文名、调性、编号或目录版次保持缺失，不自动补造。页面明确显示“未编号”和“目录版次未注明”。

## 莫扎特核心示例的逐条核对

`scripts/reviewed-works.json` 保存 12 部核心作品的编号、中文译名、别名、状态与核对链接。它们均与 Open Opus 作品标题/编号逐条对照；以下公开文献提供交叉校核依据。这里只使用作品事实和自行整理的短译名，不复制来源说明文字、乐谱或音频。

| 编号  | 可读名称                  | 核对依据                                                                                                           |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| K.331 | A大调第11钢琴奏鸣曲       | [Mozarteum MoVi](https://dme.mozarteum.at/movi/en)、[匈牙利国家塞切尼图书馆](https://mozart.oszk.hu/index_en.html) |
| K.466 | D小调第20钢琴协奏曲       | [Mozarthaus Vienna](https://www.mozarthausvienna.at/en/geschichte-des-hauses)                                      |
| K.467 | C大调第21钢琴协奏曲       | [Mozarthaus Vienna](https://www.mozarthausvienna.at/en/geschichte-des-hauses)                                      |
| K.488 | A大调第23钢琴协奏曲       | [Neue Mozart-Ausgabe 卷目](https://imslp.org/wiki/Neue_Mozart-Ausgabe)                                             |
| K.492 | 费加罗的婚礼              | [Mozarthaus Vienna](https://www.mozarthausvienna.at/en/geschichte-des-hauses)                                      |
| K.525 | G大调弦乐小夜曲           | [Mozart Documents 编号索引](https://www.mozartdocuments.org/koechel/)                                              |
| K.550 | G小调第40交响曲           | [Mozart Documents 编号索引](https://www.mozartdocuments.org/koechel/)                                              |
| K.551 | C大调第41交响曲《朱庇特》 | [Morgan Library / Mozarteum 手稿目录展](https://www.themorgan.org/exhibitions/online/mozart/439)                   |
| K.581 | A大调单簧管五重奏         | [Mozarteum MoVi](https://dme.mozarteum.at/movi/en)                                                                 |
| K.620 | 魔笛                      | [Mozarteum MoVi](https://dme.mozarteum.at/movi/en)                                                                 |
| K.622 | A大调单簧管协奏曲         | [Hallé Archive](https://archive.halle.co.uk/composer/mozart-wolfgang-amadeus)                                      |
| K.626 | D小调安魂曲（未完成）     | [Mozarteum 数字版说明](https://mozarteum.at/en/digital-mozart-edition)                                             |

这些编号是来源使用的常见标识，不声称对应最新 Köchel 2024 全目录；单曲核对不等于全部莫扎特作品收录验证。种子文件另选 6 位作曲家各 1 部来源明确的作品，共 7 位作曲家、18 部作品，覆盖状态均为 sample。正式启动后再以同一内部 ID 合并扩展目录，目录扩展后状态为 partial。

## 复核与音乐学限制

当前报告有 15,001 项复核任务，包括缺少可识别目录编号、重复名称/编号、补遗、范围或修订号。大量近现代作品原本没有通用编号，这类提示不表示作品不存在，也不会生成虚假编号。

支持 K./KV、Op.、WoO、Hess、BWV、Hob.、D.、RV 及若干来源体系的自然数字排序，保留别号、子号、罗马分组、补遗和 edition。复杂范围、附录归属及跨版对应关系需要人工复核；解析失败稳定放在该体系末尾。未编号在末尾按内部 ID 稳定排序，名称排序可另行选择。

作品集、子作品、乐章的父子关系是显式字段。来源未明确给出层级时不自动猜测合并或推断；可通过经过校核的目录文件或手动补录表达。默认只展示主层级，不单独统计子作品、乐章、作品集与明确佚失条目。现有统计是“当前已收录且按该口径可统计的条目”，仍可能存在待复核的来源粒度问题，不能解释为音乐史上的完整作品总数。

本次数据是自动获取、开发期逐条核对核心样本并生成复核清单，**不冒称已经由专业音乐学人员完成全量人工审校**。全面目录审校仍需持续进行。
