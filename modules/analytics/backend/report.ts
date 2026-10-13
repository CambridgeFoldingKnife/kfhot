// 报表查询：全部在读取时聚合（数据量很小，不建汇总表）。按北京时间切天，与站点的出刊口径一致。
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";

export interface AnalyticsReport {
  generatedAt: string;
  today: string;
  windowDays: number;
  /** 去重访客数（同一访客当天只算一次）。 */
  active: { day: number; week: number; month: number; year: number };
  views: { today: number; window: number };
  /** 平均浏览时长（毫秒），来自离开事件；没有样本时为 null。 */
  dwell: { avgMs: number | null; samples: number };
  sessions: { count: number; pagesPerSession: number | null };
  api: { today: number; window: number };
  daily: Array<{ day: string; views: number; visitors: number; apiCalls: number }>;
  topPages: Array<{ path: string; views: number }>;
  topSearches: Array<{ term: string; views: number }>;
  topReferers: Array<{ host: string; views: number }>;
  devices: Array<{ name: string; views: number }>;
  apiPaths: Array<{ path: string; calls: number }>;
}

const dayBefore = (now: Date, n: number) => beijingDate(new Date(now.getTime() - n * 86_400_000));

/** 从 User-Agent 粗分设备类型；够用即可，不做精确识别。 */
export function classifyDevice(ua: string | null): string {
  const s = ua ?? "";
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return "平板";
  if (/Mobile|Android|iPhone|iPod|Windows Phone|MicroMessenger/i.test(s)) return "手机";
  if (!s.trim()) return "未知";
  return "桌面";
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function analyticsReport(now = new Date(), windowDays = 30): Promise<AnalyticsReport> {
  const today = beijingDate(now);
  const d6 = dayBefore(now, 6);
  const d29 = dayBefore(now, 29);
  const d364 = dayBefore(now, 364);
  const dw = dayBefore(now, windowDays - 1);

  const [active] = await sql<{ day: number; week: number; month: number; year: number }[]>`
    SELECT count(DISTINCT visitor) FILTER (WHERE day = ${today}) AS day,
           count(DISTINCT visitor) FILTER (WHERE day >= ${d6})  AS week,
           count(DISTINCT visitor) FILTER (WHERE day >= ${d29}) AS month,
           count(DISTINCT visitor) FILTER (WHERE day >= ${d364}) AS year
    FROM analytics_events`;

  const [views] = await sql<{ today: number; win: number }[]>`
    SELECT count(*) FILTER (WHERE day = ${today}) AS today,
           count(*) FILTER (WHERE day >= ${dw})   AS win
    FROM analytics_events WHERE kind = 'view'`;

  const [dwell] = await sql<{ avg: number | null; samples: number }[]>`
    SELECT avg(dwell_ms)::int AS avg, count(*) AS samples
    FROM analytics_events WHERE kind = 'leave' AND dwell_ms IS NOT NULL AND day >= ${dw}`;

  const [sessions] = await sql<{ sessions: number; pages: number }[]>`
    SELECT count(DISTINCT session) AS sessions, count(*) AS pages
    FROM analytics_events WHERE kind = 'view' AND day >= ${dw}`;

  const [api] = await sql<{ today: number; win: number }[]>`
    SELECT coalesce(sum(calls) FILTER (WHERE day = ${today}), 0) AS today,
           coalesce(sum(calls) FILTER (WHERE day >= ${dw}), 0)   AS win
    FROM analytics_api_daily`;

  const dailyRows = await sql<{ day: string; views: string; visitors: string; api: string }[]>`
    WITH days AS (
      SELECT generate_series(${dw}::date, ${today}::date, '1 day')::date AS day
    ), ev AS (
      SELECT day, count(*) FILTER (WHERE kind = 'view') AS views, count(DISTINCT visitor) AS visitors
      FROM analytics_events WHERE day >= ${dw} GROUP BY day
    ), ac AS (
      SELECT day, sum(calls) AS calls FROM analytics_api_daily WHERE day >= ${dw} GROUP BY day
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
           coalesce(ev.views, 0)::text AS views,
           coalesce(ev.visitors, 0)::text AS visitors,
           coalesce(ac.calls, 0)::text AS api
    FROM days LEFT JOIN ev ON ev.day = days.day LEFT JOIN ac ON ac.day = days.day
    ORDER BY days.day`;

  const topPages = await sql<{ path: string; views: string }[]>`
    SELECT path, count(*)::text AS views FROM analytics_events
    WHERE kind = 'view' AND day >= ${dw} GROUP BY path ORDER BY count(*) DESC LIMIT 12`;

  const topSearches = await sql<{ term: string; views: string }[]>`
    SELECT search AS term, count(*)::text AS views FROM analytics_events
    WHERE kind = 'view' AND search IS NOT NULL AND day >= ${dw}
    GROUP BY search ORDER BY count(*) DESC LIMIT 12`;

  const topReferers = await sql<{ host: string; views: string }[]>`
    SELECT referer AS host, count(*)::text AS views FROM analytics_events
    WHERE kind = 'view' AND referer IS NOT NULL AND day >= ${dw}
    GROUP BY referer ORDER BY count(*) DESC LIMIT 12`;

  const uaRows = await sql<{ ua: string | null; views: string }[]>`
    SELECT ua, count(*)::text AS views FROM analytics_events
    WHERE kind = 'view' AND day >= ${dw} GROUP BY ua`;

  const apiPaths = await sql<{ path: string; calls: string }[]>`
    SELECT path, sum(calls)::text AS calls FROM analytics_api_daily
    WHERE day >= ${dw} GROUP BY path ORDER BY sum(calls) DESC LIMIT 12`;

  const byDevice = new Map<string, number>();
  for (const row of uaRows) {
    const name = classifyDevice(row.ua);
    byDevice.set(name, (byDevice.get(name) ?? 0) + num(row.views));
  }

  const sessionCount = num(sessions?.sessions);
  const pageCount = num(sessions?.pages);

  return {
    generatedAt: now.toISOString(),
    today,
    windowDays,
    active: { day: num(active?.day), week: num(active?.week), month: num(active?.month), year: num(active?.year) },
    views: { today: num(views?.today), window: num(views?.win) },
    dwell: { avgMs: dwell?.avg === null || dwell?.avg === undefined ? null : Number(dwell.avg), samples: num(dwell?.samples) },
    sessions: { count: sessionCount, pagesPerSession: sessionCount > 0 ? Math.round((pageCount / sessionCount) * 10) / 10 : null },
    api: { today: num(api?.today), window: num(api?.win) },
    daily: dailyRows.map((r) => ({ day: r.day, views: num(r.views), visitors: num(r.visitors), apiCalls: num(r.api) })),
    topPages: topPages.map((r) => ({ path: r.path, views: num(r.views) })),
    topSearches: topSearches.map((r) => ({ term: r.term, views: num(r.views) })),
    topReferers: topReferers.map((r) => ({ host: r.host, views: num(r.views) })),
    devices: [...byDevice.entries()].map(([name, views]) => ({ name, views })).sort((a, b) => b.views - a.views),
    apiPaths: apiPaths.map((r) => ({ path: r.path, calls: num(r.calls) })),
  };
}
