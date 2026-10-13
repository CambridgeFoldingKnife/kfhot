// 站点统计：信标写入与去噪、接口调用累加与路径归一、报表口径、保留期清理。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { classifyDevice, analyticsReport } from "../backend/report.ts";
import { normalizeApiPath, pruneAnalytics, recordApiCall, recordBeacon, visitorHash } from "../backend/store.ts";

const T = `an-${randomUUID().slice(0, 8)}`;
const UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) TestKit/${T}`;
const ctx = { ip: "203.0.113.7", ua: UA, siteHost: "localhost" };
after(closeDb);

const sessions = () => `${T}-${randomUUID().slice(0, 12)}`;

test("visitor ids are per-day and do not carry the raw ip", () => {
  const a = visitorHash("203.0.113.7", UA, "2026-10-13");
  const b = visitorHash("203.0.113.7", UA, "2026-10-14");
  const c = visitorHash("203.0.113.7", UA, "2026-10-13");
  assert.equal(a, c, "同一天同一个访客稳定");
  assert.notEqual(a, b, "换一天就换一个标识，跨天不可关联");
  assert.ok(!a.includes("203") && a.length === 16);
});

test("api paths keep long ids out of the buckets", () => {
  assert.equal(normalizeApiPath("/api/v1/stories/8f3a1c22b4d94e0f"), "/api/v1/stories/:id");
  assert.equal(normalizeApiPath("/api/v1/items/42?limit=5"), "/api/v1/items/:id");
  assert.equal(normalizeApiPath("/api/v1/pick"), "/api/v1/pick");
});

test("a beacon stores a view, keeps the search term, and drops bots and junk", async () => {
  const session = sessions();
  const path = `/all-${T}`;
  const before = await analyticsReport();
  const ok = await recordBeacon(
    {
      kind: "view",
      path: `${path}?q=筋膜刀&page=2`,
      session,
      referer: "https://weixin.qq.com/somewhere",
      lang: "zh-CN",
      screen: "390x844",
      search: "筋膜刀",
    },
    ctx,
  );
  assert.deepEqual(ok, { stored: true });

  const [row] = await sql<{ path: string; referer: string | null; search: string | null; visitor: string; ua: string }[]>`
    SELECT path, referer, search, visitor, ua FROM analytics_events WHERE session = ${session}`;
  assert.equal(row!.path, path, "查询串不进路径列");
  assert.equal(row!.referer, "weixin.qq.com", "来源只留主机名");
  assert.equal(row!.search, "筋膜刀");
  assert.equal(row!.ua, UA);

  const after = await analyticsReport();
  assert.ok(after.views.today >= before.views.today + 1, "页面访问量在涨");
  assert.ok(after.topPages.some((p) => p.path === path), "热门页面里有它");

  assert.deepEqual(await recordBeacon({ kind: "view", path, session }, { ...ctx, ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" }), {
    stored: false,
    reason: "bot",
  });
  assert.deepEqual(await recordBeacon({ kind: "view", path: "https://evil.example/x", session }, ctx), { stored: false, reason: "path" });
  assert.deepEqual(await recordBeacon({ kind: "view", path, session: "短" }, ctx), { stored: false, reason: "session" });
});

test("a leave event carries dwell time and scroll depth", async () => {
  const session = sessions();
  await recordBeacon({ kind: "view", path: `/item-${T}`, session }, ctx);
  await recordBeacon({ kind: "leave", path: `/item-${T}`, session, dwellMs: 12_500, scroll: 80 }, ctx);
  const [row] = await sql<{ dwell_ms: number | null; scroll: number | null }[]>`
    SELECT dwell_ms, scroll FROM analytics_events WHERE session = ${session} AND kind = 'leave'`;
  assert.deepEqual([row!.dwell_ms, row!.scroll], [12_500, 80]);
});

test("api calls accumulate into one bucket per path and status", async () => {
  const path = `/api/v1/probe-${T}`;
  for (let i = 0; i < 3; i += 1) await recordApiCall(path, "GET", 200);
  await recordApiCall(path, "GET", 404);

  const rows = await sql<{ status: number; calls: string }[]>`
    SELECT status, calls::text AS calls FROM analytics_api_daily WHERE path = ${path} ORDER BY status`;
  assert.deepEqual(rows.map((r) => [r.status, Number(r.calls)]), [[200, 3], [404, 1]], "同一个桶累加，不新增行");
});

test("the report counts today's visitors and lists api usage", async () => {
  const session = sessions();
  await recordBeacon({ kind: "view", path: `/report-${T}`, session }, ctx);
  const apiPath = `/api/v1/report-${T}`;
  await recordApiCall(apiPath, "GET", 200);
  const r = await analyticsReport();
  assert.ok(r.active.day >= 1);
  assert.ok(r.active.week >= r.active.day);
  assert.ok(r.api.today >= 1);
  assert.ok(r.apiPaths.some((p) => p.path === apiPath));
  assert.equal(r.today, beijingDate(new Date()));
});

test("devices are told apart from the user agent", () => {
  assert.equal(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "手机");
  assert.equal(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0)"), "平板");
  assert.equal(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "桌面");
  assert.equal(classifyDevice(null), "未知");
});

test("retention drops days past the window", async () => {
  const old = beijingDate(new Date(Date.now() - 500 * 86_400_000));
  const marker = `/old-${T}`;
  await sql`INSERT INTO analytics_events (day, kind, path, visitor, session) VALUES (${old}, 'view', ${marker}, ${T}, ${T})`;
  const result = await pruneAnalytics();
  assert.equal(result.cutoff! > old, true);
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analytics_events WHERE path = ${marker}`;
  assert.equal(row!.n, 0);
});
