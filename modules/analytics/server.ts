// 站点统计的后端插口：
//   POST /api/analytics/collect  浏览器信标（公开、无验证；机器人 UA 与非法输入直接丢弃）
//   GET  /api/admin/analytics    后台报表数据（走 adminHandler 的会话 + CSRF 守卫）
// 另在 api 进程挂一个 onResponse 钩子，把所有接口调用累加进 analytics_api_daily ——
// 机器流量（Agent、RSS、爬虫）不跑 JS，只有这里看得见。
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { analyticsReport } from "./backend/report.ts";
import { pruneAnalytics, recordApiCall, recordBeacon, type BeaconInput, type EventKind } from "./backend/store.ts";

const host = () => {
  try {
    return new URL(config.siteUrl).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
};

/** 信标体的宽容解析：字段不对就整条丢弃，不抛错（信标不该在页面上报错）。 */
function parseBeacon(body: unknown): BeaconInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === "leave" ? "leave" : b.kind === "view" ? "view" : null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null;
  const path = str(b.path, 300);
  const session = str(b.session, 64);
  if (!kind || !path || !session) return null;
  return {
    kind: kind as EventKind,
    path,
    session,
    referer: str(b.referer, 400),
    lang: str(b.lang, 20),
    screen: str(b.screen, 20),
    search: str(b.search, 100),
    dwellMs: int(b.dwellMs, 0, 30 * 60 * 1000),
    scroll: int(b.scroll, 0, 100),
  };
}

const intIn = (v: string | undefined, lo: number, hi: number, dflt: number) =>
  v !== undefined && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt;

export const analyticsServerModule = defineServerModule({
  name: "analytics",

  http(app: FastifyInstance) {
    // 信标：永远答 204，浏览器不需要处理任何结果。
    app.post("/api/analytics/collect", async (req, reply) => {
      const input = parseBeacon(req.body);
      if (input) {
        try {
          await recordBeacon(input, {
            ip: req.ip,
            ua: String(req.headers["user-agent"] ?? ""),
            siteHost: host(),
          });
        } catch (error) {
          req.log.warn({ err: error }, "analytics beacon dropped");
        }
      }
      return reply.code(204).send();
    });

    // 接口调用量：按日累加。健康检查是噪音，不计。
    app.addHook("onResponse", (req: FastifyRequest, reply, done) => {
      const path = (req.url ?? "").split("?")[0]!;
      if (path === "/api/health") return done();
      void recordApiCall(path, req.method, reply.statusCode, new Date()).catch(() => {});
      done();
    });

    // 后台报表数据。模块的后台接口和框架的一样走 adminHandler（会话 + CSRF）。
    app.get("/api/admin/analytics", adminHandler(async (req) => {
      const q = req.query as Record<string, string | undefined>;
      return analyticsReport(new Date(), intIn(q.days, 7, 365, 30));
    }));
  },

  // 后台导航的数据源：今天与近 7 天的访问量，做成导航上的徽标。
  admin: {
    counts: {
      "analytics.visitors": async () => {
        const { sql } = await import("@aihot/backend/db");
        const [row] = await sql<{ n: number }[]>`
          SELECT count(DISTINCT visitor)::int AS n FROM analytics_events
          WHERE day >= to_char((now() AT TIME ZONE 'Asia/Shanghai')::date - 6, 'YYYY-MM-DD')`;
        return row?.n ?? 0;
      },
    },
  },

  // 并入框架每天的保留期任务，不另加定时任务。
  retention: pruneAnalytics,
});
