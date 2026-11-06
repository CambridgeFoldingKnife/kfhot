// 看板数据的落库与读取。写入只有一个动作：整月替换（同月重传不残留）；
// 读取只有一个问题：这个月 + 前面几个月，环比和趋势都在这里算完，页面和模型只读不算。
//
// 三条口径写死在这一份文件里：
//   1) 互动量：公众号 = 分享；小红书 = 赞 + 评论 + 收藏 + 分享。不落列，改口径只改一处。
//   2) 「本月没有这个平台」≠「本月这个平台是 0」：某月某平台没有任何行就是 null，
//      参与增长的任一侧为 null 结果就是 null（页面显示「数据不足」），不补 0、不外推。
//   3) 比率类指标（互动率 / 分享率 / 千阅读涨粉）的变化出**百分点差**，不出百分比：
//      互动率从 1.2% 到 2.4% 说成「+100%」是会开错会的。
import { sql, type Db } from "@aihot/backend/db";
import { METRIC_KEYS, RATIO_METRICS, type MetricKey } from "../types.ts";
import type { AccountRow, BoardGrowth, BoardMetrics, BoardMonthRow, BoardReport, BoardWindow, ChannelType, ContentRow, LeadRow, PlatformSummary } from "../types.ts";

export interface MonthPayload {
  month: string;
  label: string;
  accounts: AccountRow[];
  contents: ContentRow[];
  channels: LeadRow[];
}

/** 整月替换：月份行 upsert，三类事实删净再插。默认自己开一个事务，上传链路也可以把它放进已有的事务里。 */
export async function replaceMonth(payload: MonthPayload, db: Db = sql): Promise<void> {
  const { month, label, accounts, contents, channels } = payload;
  await db`
    insert into board_month (month, label) values (${month}, ${label})
    on conflict (month) do update set label = excluded.label, updated_at = now()`;
  await db`delete from board_account where month = ${month}`;
  await db`delete from board_content where month = ${month}`;
  await db`delete from board_lead where month = ${month}`;

  for (const a of accounts) {
    await db`
      insert into board_account (month, platform, account, start_date, end_date, fans_start, fans_end, fans_new, raw)
      values (${month}, ${a.platform}, ${a.name}, ${a.start_date}, ${a.end_date}, ${a.fans_start}, ${a.fans_end}, ${a.fans_new}, ${sql.json(a as never)}::jsonb)`;
  }
  for (const c of contents) {
    await db`
      insert into board_content (month, platform, account, title, published_on, genre, reach, shares, new_followers, delivered, views, ctr, likes, comments, collects, url, raw)
      values (${month}, ${c.platform}, ${c.account}, ${c.title}, ${c.date}, ${c.genre}, ${c.reach}, ${c.shares}, ${c.new_followers}, ${c.delivered ?? null},
              ${c.views ?? null}, ${c.ctr ?? null}, ${c.likes ?? null}, ${c.comments ?? null}, ${c.collects ?? null}, ${c.url}, ${sql.json(c as never)}::jsonb)`;
  }
  for (const l of channels) {
    await db`
      insert into board_lead (month, platform, channel, count, channel_type, raw)
      values (${month}, ${l.platform}, ${l.name}, ${l.count}, ${l.type}, ${sql.json(l as never)}::jsonb)`;
  }
}

/** 上传链路的事务入口：整月替换 + 留痕 + 审计一起提交，中途失败就什么都还没变。 */
export async function commitMonth(payload: MonthPayload, uploads: Parameters<typeof recordUpload>[0][]): Promise<void> {
  await sql.begin(async (tx) => {
    await replaceMonth(payload, tx);
    for (const u of uploads) await recordUpload(u, tx);
  });
}

/** 一次上传留一行留痕：文件名、字节、sha256、入库/跳过行数、解析警告。传错了要能回答是谁在什么时候传的哪个文件。 */
export async function recordUpload(input: {
  batch: string;
  month: string;
  kind: string;
  actor: string;
  filename?: string;
  bytes?: number;
  sha256?: string;
  rowsOk?: number;
  rowsSkipped?: number;
  skipped?: unknown[];
  warnings?: unknown[];
  status?: string;
  error?: string | null;
}, db: Db = sql): Promise<void> {
  await db`
    insert into board_upload (batch, month, kind, filename, bytes, sha256, rows_ok, rows_skipped, skipped, warnings, status, error, created_by)
    values (${input.batch}, ${input.month}, ${input.kind}, ${input.filename ?? ""}, ${input.bytes ?? 0}, ${input.sha256 ?? ""},
            ${input.rowsOk ?? 0}, ${input.rowsSkipped ?? 0},
            ${sql.json((input.skipped ?? []) as never)}::jsonb, ${sql.json((input.warnings ?? []) as never)}::jsonb,
            ${input.status ?? "ok"}, ${input.error ?? null}, ${input.actor})`;
}

/** 传错了整月清掉（页面二次确认后调用）；月份行和三类事实一起走，留一条删除痕迹。 */
export async function deleteMonth(month: string, actor: string): Promise<void> {
  await sql`delete from board_account where month = ${month}`;
  await sql`delete from board_content where month = ${month}`;
  await sql`delete from board_lead where month = ${month}`;
  await sql`delete from board_month where month = ${month}`;
  await recordUpload({ batch: `${month}-delete`, month, kind: "delete", actor, status: "deleted" });
}

export async function listMonths(): Promise<BoardMonthRow[]> {
  return await sql`
    select month, label, updated_at
    from board_month order by month desc`;
}

export async function listUploads(month: string) {
  return await sql`
    select id, batch, kind, filename, bytes, rows_ok, rows_skipped, warnings, status, error, created_by, created_at
    from board_upload where month = ${month} order by id desc limit 50`;
}

/** 一条内容按所属平台的口径算出的互动量。排行和合计用同一个函数，不会出现两处不一致。 */
export function rowInteraction(row: ContentRow): number | null {
  if (row.platform === "wechat") return row.shares ?? null;
  const parts = [row.likes, row.comments, row.collects, row.shares];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

type BaseKey = Exclude<MetricKey, RatioKey>;
type RatioKey = (typeof RATIO_METRICS)[number];

/** 比率的分子/分母取自哪两个绝对量：total 档要分子分母各自相加再相除，不能对比率取平均。 */
const RATIOS: Record<RatioKey, { num: BaseKey; den: BaseKey; scale: number }> = {
  interactionRate: { num: "interaction", den: "reach", scale: 1 },
  shareRate: { num: "shares", den: "reach", scale: 1 },
  fansPerK: { num: "newFollowers", den: "reach", scale: 1000 },
};

const isRatio = (key: MetricKey): key is RatioKey => (RATIO_METRICS as readonly string[]).includes(key);
/** 指标 → 增长值的种类：比率出百分点、千阅读涨粉出"个"、其余出百分比。 */
const growthKind = (key: MetricKey): "abs" | "ratio" | "perk" => (key === "fansPerK" ? "perk" : isRatio(key) ? "ratio" : "abs");
const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/** 绝对量出百分比增长（基数 0 → null）；比率出百分点差。任一侧缺数据 → null。 */
export function growthOf(kind: "abs" | "ratio" | "perk", current: number | null, base: number | null): BoardGrowth | null {
  if (current === null || base === null) return null;
  if (kind === "ratio") return { kind, diff: round((current - base) * 100, 1), pct: null };
  // 千阅读涨粉本身是"每千阅读多少个"，差值就是"个"，不能再乘 100 说成百分点。
  if (kind === "perk") return { kind, diff: round(current - base, 2), pct: null };
  if (base === 0) return null;
  return { kind, diff: round(current - base, 1), pct: round(((current - base) / Math.abs(base)) * 100, 1) };
}

/** 复合月均增长率（%）：(末/首)^(1/(相隔月数)) − 1。跨度不足两个月或任一端 ≤0 → null。 */
export function cagrOf(first: number | null, last: number | null, monthsApart: number): number | null {
  if (first === null || last === null || monthsApart < 2 || first <= 0 || last <= 0) return null;
  return round((Math.pow(last / first, 1 / (monthsApart - 1)) - 1) * 100, 1);
}

export function prevMonth(month: string, back = 1): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - back;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const monthsApart = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return ty * 12 + tm - (fy * 12 + fm);
};

export const labelOf = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

interface AggRow {
  month: string;
  platform: string;
  accounts: number;
  snapshot_accounts: number;
  contents: number;
  fans_start: number | null;
  fans_end: number | null;
  fans_new: number | null;
  reach: number | null;
  shares: number | null;
  new_followers: number | null;
  interaction: number | null;
}

/** 每个（月 × 平台）一行的聚合。互动量在这一条 SQL 里就按平台口径算出来，与 rowInteraction 同一套规则。 */
async function aggregate(): Promise<AggRow[]> {
  return await sql<AggRow[]>`
    select a.month, a.platform,
           count(*)::int as accounts,
           count(a.fans_new)::int as snapshot_accounts,
           coalesce(b.contents, 0)::int as contents,
           sum(a.fans_start) as fans_start,
           sum(a.fans_end) as fans_end,
           sum(a.fans_new) as fans_new,
           b.reach, b.shares, b.new_followers, b.interaction
    from board_account a
    left join (
      select month, platform, count(*)::int as contents, sum(reach) as reach, sum(shares) as shares, sum(new_followers) as new_followers,
             case when platform = 'wechat' then sum(shares)
                  else sum(coalesce(likes, 0) + coalesce(comments, 0) + coalesce(collects, 0) + coalesce(shares, 0)) end as interaction
      from board_content group by month, platform
    ) b on b.month = a.month and b.platform = a.platform
    group by a.month, a.platform, b.contents, b.reach, b.shares, b.new_followers, b.interaction
    order by a.month, a.platform`;
}

async function leadAggregate(): Promise<Array<{ month: string; platform: string | null; total: number }>> {
  return await sql<Array<{ month: string; platform: string | null; total: number }>>`
    select month, platform, sum(count)::int as total from board_lead group by month, platform`;
}

async function monthRows(month: string) {
  const [accounts, contents, channels] = await Promise.all([
    sql<Array<AccountRow>>`
      select platform, account as name, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, fans_start, fans_end, fans_new
      from board_account where month = ${month} order by platform, account`,
    sql<Array<ContentRow>>`
      select platform, account, title, to_char(published_on, 'YYYY-MM-DD') as date, genre, reach, shares, new_followers, delivered, views, ctr, likes, comments, collects, url
      from board_content where month = ${month} order by coalesce(reach, 0) desc, title`,
    sql<Array<LeadRow>>`
      select platform, channel as name, count::int, channel_type as type from board_lead where month = ${month} order by count desc`,
  ]);
  // 互动量随行算好一起发出去：页面和排行都用这一个数，浏览器里不再有第二套口径。
  return { accounts, contents: contents.map((c) => ({ ...c, interaction: rowInteraction(c) })), channels };
}

/**
 * 某月某平台（或 total）的指标。返回 null = 这个月这个范围**没有任何数据**（缺传），
 * 与「有数据但某项是 0」严格分开 —— 后者是业务事实，前者只是没上传。
 */
function metricsFor(scope: string, month: string, agg: AggRow[], leads: Array<{ month: string; platform: string | null; total: number }>): BoardMetrics | null {
  const rows = scope === "total" ? agg.filter((r) => r.month === month) : agg.filter((r) => r.month === month && r.platform === scope);
  if (!rows.length) return null;
  const sum = (pick: (r: AggRow) => number | null): number | null => {
    const vals = rows.map(pick);
    return vals.every((v) => v === null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0);
  };
  const base: Record<string, number | null> = {
    fansNew: sum((r) => r.fans_new),
    fansEnd: sum((r) => r.fans_end),
    reach: sum((r) => r.reach),
    shares: sum((r) => r.shares),
    interaction: sum((r) => r.interaction),
    newFollowers: sum((r) => r.new_followers),
    contents: rows.reduce((s, r) => s + r.contents, 0),
  };
  // 获客：这个月一条渠道都没有 = 获客表没传（null）；有但不是这个平台的 = 该平台 0。
  const inMonth = leads.filter((l) => l.month === month);
  if (!inMonth.length) base.leads = null;
  else if (scope === "total") base.leads = inMonth.reduce((s, l) => s + l.total, 0);
  else base.leads = inMonth.filter((l) => l.platform === scope).reduce((s, l) => s + l.total, 0);

  const out: Record<string, number | null> = { ...base };
  for (const key of RATIO_METRICS) {
    const { num, den, scale } = RATIOS[key];
    const n = base[num], d = base[den];
    out[key] = n === null || d === null || d === 0 ? null : (n * scale) / d;
  }
  return out as unknown as BoardMetrics;
}

function windowFor(key: MetricKey, scope: string, month: string, months: string[], agg: AggRow[], leads: Array<{ month: string; platform: string | null; total: number }>, base: string): BoardWindow {
  const at = (target: string) => metricsFor(scope, target, agg, leads)?.[key] ?? null;
  /**
   * total 档的「谁贡献了这个指标」：某月这个指标由哪些平台给出。
   * 两个月覆盖的平台不一样时不给环比 —— 9 月小红书没有「新增」、10 月有了，
   * 直接相减会得出「+142%」，那是数据缺口造成的假增长，不是业务增长。
   */
  const coverage = (target: string) => {
    if (scope !== "total") return "";
    return [...new Set(agg.filter((r) => r.month === target).map((r) => r.platform))]
      .filter((platform) => (metricsFor(platform, target, agg, leads)?.[key] ?? null) !== null)
      .sort()
      .join(",");
  };
  const current = at(month);
  const compared = (back: number) => {
    const target = prevMonth(month, back);
    return coverage(target) === coverage(month) ? growthOf(growthKind(key), current, at(target)) : null;
  };
  const earliest = months[0] ?? null;
  const kind = growthKind(key);
  return {
    current,
    // 「对比基准月」由页面选择；默认等于上一自然月，所以默认情况下和 g1 是同一个数。
    gCompare: base === month ? null : (coverage(base) === coverage(month) ? growthOf(kind, current, at(base)) : null),
    g1: compared(1),
    g2: compared(2),
    g3: compared(3),
    cagr: kind === "abs" && earliest && coverage(earliest) === coverage(month) ? cagrOf(at(earliest), current, monthsApart(earliest, month) + 1) : null,
    since: earliest,
  };
}

export async function loadReport(month: string, compare: string | null = null): Promise<BoardReport | null> {
  const [agg, leads, detail, prev] = await Promise.all([aggregate(), leadAggregate(), monthRows(month), monthRows(prevMonth(month, 1))]);
  const months = [...new Set(agg.map((r) => r.month))].sort();
  if (!months.includes(month)) return null;

  const present = (target: string) => [...new Set(agg.filter((r) => r.month === target).map((r) => r.platform))];
  const scopes = [...present(month), "total"];
  const compareMonth = compare ?? prevMonth(month, 1);
  const prevPlatforms = compare ? present(compare) : present(prevMonth(month, 1));

  // 对比基准：页面选了就用选的，没选就是上一自然月。对比表第一列和 KPI 卡都按它算。
  const base = compare ?? prevMonth(month, 1);
  const growth: Record<string, BoardWindow> = {};
  for (const scope of scopes) for (const key of METRIC_KEYS) growth[`${scope}.${key}`] = windowFor(key, scope, month, months, agg, leads, base);

  const channels = detail.channels;
  const typeMap = new Map<string, number>();
  for (const c of channels) typeMap.set(c.type, (typeMap.get(c.type) ?? 0) + c.count);

  const prevAccounts = compare
    ? await sql<Array<{ platform: string; account: string }>>`
        select c.platform, c.account from board_account c
        left join board_account n on n.month = ${month} and n.platform = c.platform and n.account = c.account
        where c.month = ${compare} and n.account is null order by c.platform, c.account`
    : [];

  return {
    month,
    label: labelOf(month),
    base,
    compare,
    months,
    platforms: present(month).map<PlatformSummary>((platform) => {
      const row = agg.find((r) => r.month === month && r.platform === platform)!;
      return { ...(metricsFor(platform, month, agg, leads) as BoardMetrics), platform, present: true, accounts: row.accounts, snapshotAccounts: row.snapshot_accounts };
    }),
    total: metricsFor("total", month, agg, leads) as BoardMetrics,
    accounts: detail.accounts,
    contents: detail.contents,
    prevAccounts: prev.accounts,
    channels,
    channelTypes: [...typeMap].sort((a, b) => b[1] - a[1]).map<ChannelType>(([type, count]) => ({ type, count })),
    leadsTotal: metricsFor("total", month, agg, leads)?.leads ?? null,
    growth,
    missingPlatforms: prevPlatforms.filter((p) => !present(month).includes(p)),
    missingAccounts: prevAccounts,
    trend: months.map((m) => ({ month: m, label: labelOf(m), total: metricsFor("total", m, agg, leads) })),
  };
}
