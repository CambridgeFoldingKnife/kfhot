// 看板的数据形状。字段名沿用 2026-10 那版静态产物（kfhot/web/public/board/2026-09.json），
// 这样「解析入库的结果 vs 旧产物」可以逐字段直接比，不用中间映射。
// 三个平台的列不一样（公众号有送达、小红书有观看/点击率/赞评藏），所以取并集，各平台缺的那几列是 null。

export type PlatformKey = "wechat" | "xhs";

/** 总表里 sheet 名前缀 → 平台键。加平台只改这一处（列序映射在 parse.ts 的 ROW_SHAPE）。 */
export const PLATFORM_PREFIXES: Record<string, PlatformKey> = {
  公众号: "wechat",
  小红书: "xhs",
};

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  wechat: "公众号",
  xhs: "小红书",
};

export const PLATFORM_KEYS = Object.keys(PLATFORM_LABELS) as PlatformKey[];

/** 一个账号一个月末/月初的粉丝快照。小红书普遍没有增量快照 → fans_new 为 null，不能当 0。 */
export interface AccountRow {
  platform: PlatformKey;
  name: string;
  start_date: string | null;
  end_date: string | null;
  fans_start: number | null;
  fans_end: number | null;
  fans_new: number | null;
}

export interface ContentRow {
  platform: PlatformKey;
  account: string;
  title: string;
  /** 发表日期，ISO 'YYYY-MM-DD'；表里认不出来就是 null（仍入库，页面上排到最后）。 */
  date: string | null;
  genre: string;
  /** 公众号=阅读人数，小红书=曝光。 */
  reach: number | null;
  shares: number | null;
  new_followers: number | null;
  /** 仅公众号：送达人数。 */
  delivered?: number | null;
  /** 仅小红书。 */
  views?: number | null;
  ctr?: number | null;
  likes?: number | null;
  comments?: number | null;
  collects?: number | null;
  url: string;
  /** 读取层按平台口径算好的互动量（公众号=分享，小红书=赞+评+藏+分）；入库时为空，页面直接用。 */
  interaction?: number | null;
}

export interface LeadRow {
  platform: PlatformKey | null;
  name: string;
  count: number;
  type: string;
}

/** 被跳过的行也要留痕：页面上要能列出「为什么这行没进来」。 */
export interface SkippedRow {
  sheet: string;
  row: number;
  reason: string;
  title: string;
}

export interface ParseIssue {
  sheet?: string;
  message: string;
}

/** 一份总表的解析结果。accounts/contents 是要入库的，其余是给页面和排错用的。 */
export interface MasterParse {
  accounts: AccountRow[];
  contents: ContentRow[];
  /** 识别到的平台 → 该平台的粉丝快照日期范围（用来反查管理员选的月份）。 */
  snapshot: { min: string; max: string } | null;
  sheets: string[];
  /** 名字不符合「平台-账号」的 sheet —— 这些过去被静跳过，现在要显式列出来。 */
  unknownSheets: string[];
  skipped: SkippedRow[];
  /** 整批不入库的原因。 */
  errors: ParseIssue[];
  /** 可以入库，但要看一眼。 */
  warnings: ParseIssue[];
}

export interface LeadsParse {
  channels: LeadRow[];
  total: number;
  errors: ParseIssue[];
  warnings: ParseIssue[];
}

/** 上传接口的返回：解析结果 + 每个文件的留档信息。 */
export interface UploadPreview {
  month: string;
  master: MasterParse;
  leads: LeadsParse | null;
  files: Array<{ field: string; filename: string; bytes: number; sha256: string }>;
}

// ---- 下面是读取层（store.ts）算好后交给页面和模型的形状 ----

/** 一个增长值：绝对量出 pct（百分比）+ diff（差值）；比率只出 diff，单位是百分点。 */
export interface BoardGrowth {
  /** abs：绝对量；ratio：百分比比率（差值＝百分点）；perk：每千阅读涨粉（差值＝个）。 */
  kind: "abs" | "ratio" | "perk";
  diff: number | null;
  pct: number | null;
}

/** 同一指标在 近 1 / 近 2 / 近 3 个月三个窗口上的增长，外加复合月均。任一端缺数据就是 null。 */
export interface BoardWindow {
  current: number | null;
  /** 与页面上所选「对比基准月」相比。默认是上一自然月；KPI 卡和对比表的第一列都用它。 */
  gCompare: BoardGrowth | null;
  g1: BoardGrowth | null;
  g2: BoardGrowth | null;
  g3: BoardGrowth | null;
  /** 复合月均增长率（%）；跨度不足两个月或任一端 ≤0 为 null。 */
  cagr: number | null;
  /** 参与复合计算的起点月份，null 表示历史不足。 */
  since: string | null;
}

export interface BoardMetrics {
  fansNew: number | null;
  fansEnd: number | null;
  reach: number | null;
  shares: number | null;
  interaction: number | null;
  newFollowers: number | null;
  contents: number | null;
  leads: number | null;
  interactionRate: number | null;
  shareRate: number | null;
  fansPerK: number | null;
}

export interface PlatformSummary extends BoardMetrics {
  platform: string;
  present: boolean;
  accounts: number;
  /** 有粉丝快照的账号数；小于 accounts 说明这一档的粉丝合计不完整。 */
  snapshotAccounts: number;
}

export interface ChannelType {
  type: string;
  count: number;
}

/**
 * 指标的名称与顺序。放在这里而不是 store.ts：页面要按同一份清单渲染，
 * 而 store.ts 连着数据库，不能被浏览器侧 import。
 * 前三项是比率（互动率 / 分享率 / 千阅读涨粉），它们的变化出百分点差，其余出百分比。
 */
export const METRIC_KEYS = [
  "fansNew", "fansEnd", "reach", "shares", "interaction", "newFollowers", "contents", "leads",
  "interactionRate", "shareRate", "fansPerK",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  fansNew: "新增粉丝",
  fansEnd: "粉丝总量",
  reach: "阅读 / 曝光",
  shares: "分享",
  interaction: "互动量",
  newFollowers: "内容带来关注",
  contents: "内容条数",
  leads: "获客线索",
  interactionRate: "互动率",
  shareRate: "分享率",
  fansPerK: "千阅读涨粉",
};

/** 比率类指标：变化按百分点说，不说成百分比。 */
export const RATIO_METRICS = ["interactionRate", "shareRate", "fansPerK"] as const;
export type RatioMetricKey = (typeof RATIO_METRICS)[number];


export interface BoardMonthRow {
  month: string;
  label: string;
  updated_at: string;
}

/** 一条「关键变化」卡片：值原样来自表格，tone 只用于着色。 */
export interface AnalysisHighlight {
  label: string;
  value: string;
  change: string;
  tone: "up" | "down" | "flat";
}

/** 分析的展示结构：关键变化 + 分段解读 + 编号建议。老数据没有这个结构，就退回纯文本 body。 */
export interface AnalysisData {
  highlights?: AnalysisHighlight[];
  reading?: string;
  advice?: string[];
  [key: string]: unknown;
}

/** 公开出口给的分析：正文（纯文本）+ 可选结构。 */
export interface PublishedAnalysis {
  body: string;
  data: AnalysisData | null;
}

/** 月度 AI 分析（后台草稿 + 公开页已发布）。 */
export interface AnalysisRow {
  month: string;
  body: string;
  model: string | null;
  prompt: string | null;
  published: boolean;
  published_at: string | null;
  error: string | null;
  created_at: string;
  data: AnalysisData | null;
}

/** 一期的完整看板数据。growth 的键是 `${平台|total}.${指标}`。 */
export interface BoardReport {
  month: string;
  label: string;
  /** 实际用于对比的基准月（选了就用选的，没选就是上一自然月）。 */
  base: string;
  compare: string | null;
  months: string[];
  platforms: PlatformSummary[];
  total: BoardMetrics;
  accounts: AccountRow[];
  contents: ContentRow[];
  channels: LeadRow[];
  channelTypes: ChannelType[];
  leadsTotal: number | null;
  /** 上一自然月的账号快照：账号进度条上那道「上月位置」的刻度用它，缺的账号就没有刻度。 */
  prevAccounts: AccountRow[];
  growth: Record<string, BoardWindow>;
  /** 对比月有、本月没有的平台（忘导 sheet 就在这里露出来）。 */
  missingPlatforms: string[];
  missingAccounts: Array<{ platform: string; account: string }>;
  trend: Array<{ month: string; label: string; total: BoardMetrics | null }>;
}

