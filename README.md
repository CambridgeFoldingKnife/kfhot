# 健衡医疗 · 康复资讯聚合平台

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  <b>盯住康复领域值得看的动态，写成中文标题与摘要，每天出一份读得完的康复日报。</b>
</p>

<p align="center">
  <a href="#这是什么">这是什么</a> ·
  <a href="#信源">信源</a> ·
  <a href="#它是怎么工作的">它是怎么工作的</a> ·
  <a href="#公开接口">公开接口</a> ·
  <a href="#跑起来">跑起来</a> ·
  <a href="#文档">文档</a>
</p>

<br>

## 这是什么

健衡医疗康复资讯聚合平台，每天从一批康复领域的信源里收资料，用大模型先筛一遍、再独立打两次分，挑出真正值得看的，写成中文标题和摘要；把不同来源说的同一件事聚成一个事件，按有多少个独立来源在说排出热点；每天早上出一份日报，周一出周报、每月 1 日出月报。

站点只展示标题、摘要和原文链接，原文版权归各来源所有。面向读者的网页、RSS、公开 API、Agent Markdown 和 MCP 都是**匿名只读、不需要注册**的。

## 信源

现在接入 **33 个信源**，按证据等级分三级（T1 官方一手 / T1_5 官方账号与准官方 / T2 媒体与个人），各级入选门槛不同。

| 类型 | 数量 | 说明 |
|---|---|---|
| 期刊与预印本 | 9 | 走 Europe PMC，按检索式订阅：筋膜刀（IASTM/Graston）、Cochrane 系统综述、运动康复、运动损伤、神经康复、肌骨康复、心肺康复、儿童与青少年体态、物理治疗实践与教育 |
| 官方机构与院校 | 7 | 中国政府网（最新政策）、NATA 美国运动防护师协会、ISPRM 国际物理与康复医学会、WHO 世界卫生组织、中国康复医学会、北京体育大学、中国卫生人才网 |
| 国内医学媒体 | 1 | 梅斯医学（康复共识与指南） |
| 微信公众号 | 16 | 经「极致了」按账号订阅，含中国康复医学会物理治疗专委会、康复医学研究、指南与康复文献速递、手功能康复协作平台、脊近完美、肌本自然、康复医学网、丁香医生、华晟康复、SFNG 富脊重塑脑科学技术等 |

> 微信公众号只取标题、摘要与原文链接（`fetchBody: false`），不抓正文。

## 它是怎么工作的

一条资料从信源进来，先判重，再预筛；可能重要的独立打两次分，写好中文标题和摘要，和别的报道聚成事件，算进热度。分数过了门槛、又不是精选里已有新闻的重复，才进精选。

- **采集**：RSS、网页列表、JSON 接口、微信公众号，以及外部脚本推送。抓取频率按各源产出自动调整。
- **预筛与评分**：每一步的提示词都在 [`industry/prompts/`](industry/prompts/)，改标准不用改代码；入选门槛在 [`industry/selection.ts`](industry/selection.ts)。
- **归组与热度**：同一件事只让读者看一次；热度按**事件**算，48 小时内每个独立来源只算一次，一家媒体发十篇也只算一次。
- **成刊**：日报每天 08:00、周报每周一 10:00、月报每月 1 日 10:30（北京时间），出刊时间在 [`site/site.ts`](site/site.ts) 的 `EDITION_TIMES` 里改。

## 你会得到什么

| | |
|---|---|
| **精选** | 预筛 + 两次独立评分 + 按信源分级设门槛；同一条新闻只占一条，换个说法的重复不进 |
| **写作** | 中文标题、答案先行的摘要、推荐理由，外文全文翻译；分类、标签与新闻事实单独抽取 |
| **聚簇与热点** | 不同来源的同一件事聚成一个事件，事件页有综述；热点榜按独立来源数排序 |
| **日报、周报、月报** | 每天一份日报，按规则编出当天要闻；周报、月报从日报汇编 |
| **主题与搜索** | 27 个长期追踪的主题（神经康复、脑卒中康复、肌骨康复与颈肩腰腿痛、筋膜刀与软组织松解、手法治疗与干针、康复机器人与数字康复……）；标题摘要搜索与全文相关搜索 |
| **给 Agent 用** | RSS、公开 API、MCP、Agent Markdown、`llms.txt`，同一份内容给人看也给 Agent 用 |
| **对内选题素材** | [`modules/pick`](modules/pick/) 提供自动选题素材包 `/api/v1/pick` 与公众号素材榜 `/api/v1/materials`（带阅读数、点赞数），供内部写作用 |
| **后台** | 信源管理与试抓、内容诊断、精选评测、每一步单独换模型、付费服务的预算熔断、运行记录与告警 |

## 公开接口

站点跑起来后，打开 `/agent` 可以复制 MCP、RSS 或 API 的接入方式；只能读网页的 Agent 从 `/api/v1/agent` 开始；接口说明在 `/openapi-v1.json`，机器可读的说明在 `/llms.txt`。

| 出口 | 地址 |
|---|---|
| 精选（机器用，一条事实一个席位） | `/api/v1/items?mode=selected` |
| 全部动态（含未入选，只进网页与 RSS） | `/api/v1/items?mode=all` |
| 热点榜 | `/api/v1/hot-topics` |
| 事件页 | `/api/v1/stories/{publicId}` |
| 日报 | `/api/v1/dailies/latest`（往期 `/api/v1/dailies`） |
| 周报 / 月报 | `/api/v1/weeklies/latest`、`/api/v1/monthlies/latest` |
| 增量同步 | `/api/v1/selected/snapshot`、`/api/v1/selected/changes` |
| 选题素材包 | `/api/v1/pick` |
| 公众号素材榜（含阅读数、点赞数） | `/api/v1/materials` |
| 接入说明 | `/api/v1/agent`、`/llms.txt`、`/openapi-v1.json` |
| RSS 订阅 | `/feed.xml`（精选）、`/feed/all.xml`、`/feed/full.xml`、`/feed/daily.xml`、`/feed/weekly.xml`、`/feed/monthly.xml` |

## 跑起来

需要 [Docker](https://docs.docker.com/get-started/get-docker/)、[Node.js 24](https://nodejs.org/en/download)（运行 `init-env` 生成配置要用），和一个 OpenAI 兼容的模型 API Key。

```bash
git clone https://github.com/CambridgeFoldingKnife/kfhot.git
cd kfhot
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。

微信公众号通道需要另一个 Key：在 `.env` 里填 `DAJIALA_KEY`（「极致了」按账号订阅）。留空时公众号信源不排任务，其余信源照常工作。

服务器上部署、配域名和 HTTPS、更新与备份、或者不用 Docker 直接在 Linux / macOS（Windows 用 WSL2）上跑，见 [部署](docs/deploy.md)。

## 项目结构

定制几乎都落在两个目录里，框架代码基本不用动：

| 目录 | 放什么 |
|---|---|
| [`site/`](site/) | 站名文案（`site.ts`）、品牌与图标（`brand/`）、条款与隐私（`pages/`）、发布在网站根目录的固定文件（`public/`）、更新日志（`changelog.json`） |
| [`industry/`](industry/) | 分类与标签（`taxonomy.ts`）、主题（`topics.json`）、信源（`sources.json`）、**提示词（`prompts/`）、入选门槛（`selection.ts`）** |
| [`modules/`](modules/) | 只有本站要的功能：`pick`（选题素材包与素材榜）、`quality`（质检与金标抽样工具） |

## 文档

| 文档 | 内容 |
|---|---|
| [部署](docs/deploy.md) | Docker、域名和 HTTPS、中国大陆、更新、备份，不用 Docker 时怎么跑 |
| [信源](docs/sources.md) | 各类信源怎么配，分级和全文，抓取频率，外部推送接口 |
| [精选与校准](docs/selection.md) | 一条资料怎么变成精选、怎么编进日报周报月报，怎么用自己的样本校准门槛 |
| [事件归组与关系评测](docs/grouping.md) | 事件关系怎么判断，怎么用标注样本评测 |
| [架构](docs/architecture.md) | 进程、不变的规则、目录、模块、数据库迁移、对外出口、测试 |
| [改成你的行业](docs/customize.md) | 站名、分类、主题、信源、提示词、门槛、模型、品牌，一步一步来 |

技术栈：Node.js 24 · TypeScript · React Router（服务端渲染）· Fastify · PostgreSQL · pg-boss · Tailwind CSS · Docker Compose。

## 许可

代码使用 [MIT 许可证](LICENSE)；字体等第三方资源的许可见 [NOTICE](NOTICE)。

本站的品牌、信源名单、评分标准与提示词为本项目自建，不在开源许可的授权范围内。
