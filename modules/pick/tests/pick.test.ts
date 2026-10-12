// 自动选题：分类标签不算主题；跨主题轮转；同一主题只多带一条次素材；不在窗口或未上架的内容不入选。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { buildPicks, topicOf, type PickResult } from "../backend/pick.ts";
import { buildMaterials } from "../backend/materials.ts";
import { pickServerModule } from "../server.ts";

const T = `pick-${randomUUID().slice(0, 8)}`;
after(closeDb);

function article(id: string, title: string, tags: string[], minutesAgo: number, listed = true) {
  return sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${T}, ${id}, ${`https://example.org/${id}`}, ${title},
            now() - ${`${minutesAgo} minutes`}::interval, now() - ${`${minutesAgo} minutes`}::interval)`;
}
function publication(id: string, title: string, tags: string[], minutesAgo: number, listed = true) {
  return sql`INSERT INTO publications (article_id, revision, visibility, eligible, selected, title, summary, category, tags, source_id, channel, url, discovered_at, timeline_at, sort_at)
    VALUES (${id}, 1, ${listed ? "public" : "withdrawn"}, ${listed}, false, ${title}, ${`摘要 ${title}`}, 'research', ${sql.array(tags)}::text[], ${T}, 'news',
            ${`https://example.org/${id}`}, now() - ${`${minutesAgo} minutes`}::interval, now() - ${`${minutesAgo} minutes`}::interval, now() - ${`${minutesAgo} minutes`}::interval)`;
}

test("topic tags exclude category tags, and picks rotate across topics", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${T}, 'Pick fixture', 'rss', 'T1', 'editorial')`;
  const rows: Array<[string, string, string[], number]> = [
    ["a1", "脑卒中早期活动研究一", ["论文/研究", "脑卒中"], 10],
    ["a2", "脑卒中早期活动研究二", ["论文/研究", "脑卒中"], 20],
    ["a3", "脑卒中早期活动研究三", ["论文/研究", "脑卒中"], 30],
    ["b1", "筋膜刀系统综述", ["论文/研究", "筋膜刀"], 15],
    ["c1", "只有分类标签的稿子", ["论文/研究"], 5],
    ["old", "窗口外的旧稿", ["论文/研究", "脑卒中"], 60 * 24 * 30],
    ["hidden", "已撤下的稿子", ["论文/研究", "筋膜刀"], 6],
  ];
  for (const [id, title, tags, mins] of rows) {
    await article(`${T}-${id}`, title, tags, mins);
    await publication(`${T}-${id}`, title, tags, mins, id !== "hidden");
  }

  assert.equal(topicOf(["论文/研究", "脑卒中"]), "脑卒中");
  assert.equal(topicOf(["论文/研究"]), "(综合)");

  const res = await buildPicks({ count: 5, days: 7 });
  assert.equal(res.count, res.picks.length);
  assert.ok(res.count >= 3, "窗口内可选题的条目都该出得来");
  assert.ok(!res.picks.some((p) => p.items.some((i) => i.id.endsWith("-old"))), "窗口外的不入选");
  assert.ok(!res.picks.some((p) => p.items.some((i) => i.id.endsWith("-hidden"))), "已撤下的不入选");

  // 轮转：主题交替出现，不把同一主题连排到底；只有分类标签的稿子排在各主题之后。
  const topics = res.picks.map((p) => p.topic);
  assert.ok(new Set(topics).size >= 2, "应跨主题轮转");
  assert.notEqual(topics[0], "(综合)", "综合桶不排最前");
  assert.ok(topics.includes("(综合)"), "只有分类标签的稿子归入综合桶");
  assert.ok(topics.indexOf("(综合)") > topics.indexOf("脑卒中"), "综合桶排在真实主题之后");

  const stroke = res.picks.find((p) => p.topic === "脑卒中")!;
  assert.equal(stroke.items.length, 2, "同一主题一次只多带一条次素材");
  assert.ok(stroke.direction.includes("围绕近期素材展开"), "direction 是选题方向");
  assert.equal(stroke.items[0]!.id, `${T}-a1`, "主素材取该主题最新的一条");

  const one = await buildPicks({ count: 5, days: 7, topic: "筋膜刀" });
  assert.ok(one.picks.every((p) => p.topic === "筋膜刀"), "topic 过滤后只剩该主题");
});

test("materials rank WeChat posts by read/like and drop withdrawn ones", async () => {
  const M = `${T}-mp`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${M}, '素材榜夹具', 'mp_account', 'T2', 'editorial')`;
  // 注意：`${M}-${id}` 会被拆成两个参数、SQL 变成 `$1-$2`（两次 unknown 相减直接报错），先在 JS 拼好。
  const put = (id: string, title: string, read: number | null, zan: number | null, mins: number) => {
    const full = `${M}-${id}`;
    return sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, raw)
    VALUES (${full}, ${M}, ${full}, ${`https://mp.weixin.qq.com/s/${id}`}, ${title},
            now() - ${`${mins} minutes`}::interval, now() - ${`${mins} minutes`}::interval,
            ${sql.json({ dajiala: { read, zan } })})`;
  };
  await put("h1", "高阅读的营销稿", 3898, 16, 30);
  await put("h2", "低阅读的招聘通知", 465, 2, 20);
  await put("h3", "无互动数据的新稿", null, null, 10);
  await put("h4", "已撤下的爆款", 9999, 99, 5);
  await sql`INSERT INTO publications (article_id, revision, visibility, eligible, selected, title, category, tags, source_id, channel, url, discovered_at, timeline_at, sort_at)
    VALUES (${`${M}-h4`}, 1, 'withdrawn', true, false, '已撤下的爆款', 'industry', ARRAY[]::text[], ${M}, 'news', 'https://mp.weixin.qq.com/s/h4', now(), now(), now())`;

  const byRead = await buildMaterials({ days: 7, limit: 10, sort: "read" }, new Date());
  assert.deepEqual(byRead.items.map((m) => m.id), [`${M}-h1`, `${M}-h2`, `${M}-h3`]);
  assert.equal(byRead.items[0]!.read, 3898);
  assert.equal(byRead.items[2]!.read, null, "没有互动数据的排在最后");
  assert.ok(!byRead.items.some((m) => m.id.endsWith("-h4")), "已撤下的不进素材榜");

  const byZan = await buildMaterials({ days: 7, limit: 10, sort: "zan" }, new Date());
  assert.equal(byZan.sort, "zanDesc");
  const recent = await buildMaterials({ days: 7, limit: 10, sort: "recent", sourceId: M }, new Date());
  assert.equal(recent.items[0]!.id, `${M}-h3`, "按时间排时最新的在前");
});

test("the agent ability answers and runs with empty args on a site with no content", async () => {
  const ability = pickServerModule.agent!.abilities![0]!;
  assert.equal(ability.path, "/pick");
  // 空库也要能跑（mcp-check 会用 {} 真调一次）：run 不抛错、structured 结构与 HTTP 出口一致。
  const { text, structured } = await ability.mcp.run({});
  assert.equal(typeof text, "string");
  assert.ok(text.length > 0, "空库也要给一句人话");
  const r = structured as unknown as PickResult;
  assert.deepEqual(Object.keys(r).sort(), ["count", "date", "days", "picks", "topic"]);
  assert.ok(Array.isArray(r.picks));
  assert.match(await ability.answer(), /\S/);
});
