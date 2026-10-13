// 站点数据的写入与保留：访客行为的信标落到 analytics_events，接口调用累加到 analytics_api_daily。
// 隐私约定：不存原始 IP、不种 cookie。访客标识是（IP + User-Agent + 当日 + 密钥盐）的哈希前缀，
// 只用于当天去重；跨天不可关联，也无法从哈希反推 IP。
import { createHash } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { credential } from "@aihot/backend/config";
import { beijingDate } from "@aihot/contracts/time";

/** 事件种类：view = 看了一页；leave = 离开该页（补停留时长与滚动深度）。 */
export type EventKind = "view" | "leave";

export interface BeaconInput {
  kind: EventKind;
  path: string;
  session: string;
  referer?: string | null;
  lang?: string | null;
  screen?: string | null;
  search?: string | null;
  dwellMs?: number | null;
  scroll?: number | null;
}

/** 机器人不发信标，但它们的 User-Agent 也可能直接打信标接口：这类不入库。 */
const BOT = /bot|crawler|spider|curl|wget|python-requests|headless|facebookexternalhit|slurp|bingpreview/i;

const MAX_DWELL_MS = 30 * 60 * 1000;
const MAX_PATH = 300;

function salt(): string {
  return credential("auth", "SESSION_SECRET") ?? "analytics-local-salt";
}

/** 当日访客标识：换一天就换一个，跨天不可关联。 */
export function visitorHash(ip: string, ua: string, day: string): string {
  return createHash("sha256").update(`${ip}|${ua}|${day}|${salt()}`).digest("hex").slice(0, 16);
}

/** 只留站内路径；去掉查询串与哈希，避免把搜索词这类内容写进路径列。 */
function cleanPath(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const noQuery = value.split("?")[0]!.split("#")[0]!;
  return noQuery.length > MAX_PATH ? noQuery.slice(0, MAX_PATH) : noQuery;
}

/** 外部来源只留主机名，站内跳转（referer 为空或同站）记 null。 */
function refererHost(raw: string | null | undefined, siteHost: string): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === siteHost ? null : host;
  } catch {
    return null;
  }
}

export interface BeaconContext {
  ip: string;
  ua: string;
  siteHost: string;
  now?: Date;
}

/** 记一条页面事件。返回值只用于测试。 */
export async function recordBeacon(input: BeaconInput, ctx: BeaconContext): Promise<{ stored: boolean; reason?: string }> {
  if (BOT.test(ctx.ua)) return { stored: false, reason: "bot" };
  const path = cleanPath(input.path);
  if (!path) return { stored: false, reason: "path" };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.session)) return { stored: false, reason: "session" };

  const now = ctx.now ?? new Date();
  const day = beijingDate(now);
  const visitor = visitorHash(ctx.ip, ctx.ua, day);
  const dwell = input.dwellMs === null || input.dwellMs === undefined ? null : Math.max(0, Math.min(MAX_DWELL_MS, Math.round(input.dwellMs)));
  const scroll = input.scroll === null || input.scroll === undefined ? null : Math.max(0, Math.min(100, Math.round(input.scroll)));

  await sql`
    INSERT INTO analytics_events (at, day, kind, path, visitor, session, referer, ua, lang, screen, search, dwell_ms, scroll)
    VALUES (${now}, ${day}, ${input.kind}, ${path}, ${visitor}, ${input.session},
            ${refererHost(input.referer, ctx.siteHost)}, ${ctx.ua.slice(0, 300)},
            ${input.lang?.slice(0, 20) ?? null}, ${input.screen?.slice(0, 20) ?? null},
            ${input.search?.trim().slice(0, 100) || null}, ${dwell}, ${scroll})`;
  return { stored: true };
}

/** 路径里的长 id 归一成 :id，让它成为有界的桶而不是每篇文章一行。 */
export function normalizeApiPath(path: string): string {
  const noQuery = path.split("?")[0]!;
  const trimmed = noQuery.length > 120 ? noQuery.slice(0, 120) : noQuery;
  return trimmed.replace(/\/[0-9a-f]{12,}/gi, "/:id").replace(/\/\d+/g, "/:id");
}

/** 记一次接口调用（api 进程的全局钩子调用；不记录 /api/health）。 */
export async function recordApiCall(path: string, method: string, status: number, now = new Date()): Promise<void> {
  const day = beijingDate(now);
  const normalized = normalizeApiPath(path);
  await sql`
    INSERT INTO analytics_api_daily (day, path, method, status, calls)
    VALUES (${day}, ${normalized}, ${method.slice(0, 10)}, ${status}, 1)
    ON CONFLICT (day, path, method, status) DO UPDATE SET calls = analytics_api_daily.calls + 1`;
}

/** 保留期：页面事件与接口计数都按天清理（年活跃需要一年，所以留 400 天）。 */
export const ANALYTICS_RETENTION_DAYS = 400;

export async function pruneAnalytics(now = new Date()): Promise<Record<string, unknown>> {
  const cutoff = beijingDate(new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86_400_000));
  const events = await sql`DELETE FROM analytics_events WHERE day < ${cutoff}`;
  const api = await sql`DELETE FROM analytics_api_daily WHERE day < ${cutoff}`;
  return { cutoff, events: events.count, api: api.count };
}
