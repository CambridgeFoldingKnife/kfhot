// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - an institution topic takes an article about another institution that only mentions it (several
//   subjects, its name nowhere in the title), or drops one about it whose title names it only by an
//   alias, only in English, or only next to Chinese text (it is the article's only subject);
// - a Latin acronym matches inside another word ("Whole-body" is not WHO); a headline naming an
//   institution that is not a subject of the article gets in;
// - a technique topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

/** 类别 → 该类别下用的分类标签，与 industry/taxonomy.ts 的 CATEGORY_TAGS 对应。 */
const CATEGORY_TAG: Record<string, string> = {
  guideline: "指南/共识",
  research: "论文/研究",
  institution: "机构动态",
  policy: "政策/执业",
  device: "器械/技术",
  industry: "行业动态",
  education: "科普/教育",
  opinion: "观点/述评",
};

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "guideline"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[CATEGORY_TAG[r.category ?? "guideline"] ?? "指南/共识", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("an institution topic takes the articles about it, not the ones that only mention it", async () => {
  // 中国康复医学会(carm)是主追踪机构；ISPRM 是第二个机构主题；WHO 用来验证拉丁缩写边界。
  const about = await report({ at: hoursAgo(30), title: `中国康复医学会发布物理治疗临床指南 ${T}`, subjects: ["carm"] });
  const byAlias = await report({ at: hoursAgo(31), title: `康复医学会发布新技术规范 ${T}`, subjects: ["carm"] });
  const inEnglish = await report({ at: hoursAgo(32), title: `新指南发布 ${T}`, originalTitle: `CARM publishes a clinical guideline ${T}`, subjects: ["carm", "isprm"] });
  const namedIsprm = await report({ at: hoursAgo(33), title: `ISPRM 发布国际康复共识 ${T}`, subjects: ["isprm", "carm", "cochrane"] });
  const lowerIsprm = await report({ at: hoursAgo(34), title: `isprm 公布新的培训规范 ${T}`, subjects: ["isprm", "carm"] });
  const noName = await report({ at: hoursAgo(35), title: `多家机构联合发布康复共识 ${T}`, subjects: ["isprm", "carm", "who"] });
  const wholeBody = await report({ at: hoursAgo(36), title: `ISPRM 新共识把 Whole-body 振动训练纳入 ${T}`, subjects: ["who", "isprm"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布WHO的康复指南 ${T}`, subjects: ["who", "isprm"] });
  const headlineOnly = await report({ at: hoursAgo(38), title: `中国康复医学会被一篇盘点提到 ${T}`, subjects: ["isprm"] });
  const iastm = await report({ at: hoursAgo(39), title: `筋膜刀用于慢性踝关节不稳的疗效 ${T}`, tags: ["筋膜刀"] });

  const carm = await members("carm");
  for (const id of [about, byAlias, inEnglish]) assert.ok(carm.includes(id), "about CARM");
  for (const id of [namedIsprm, lowerIsprm, noName, headlineOnly]) assert.ok(!carm.includes(id), "only mentions CARM");
  const isprm = await members("isprm");
  for (const id of [namedIsprm, lowerIsprm, wholeBody]) assert.ok(isprm.includes(id), "about ISPRM");
  for (const id of [inEnglish, noName]) assert.ok(!isprm.includes(id), "only mentions ISPRM");
  const who = await members("who");
  assert.ok(who.includes(adjacent), "WHO next to Chinese text");
  assert.ok(!who.includes(wholeBody), "Whole-body is not WHO");
  assert.ok((await members("iastm")).includes(iastm), "a technique topic takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual((await topicsOf(about)).sort(), ["carm", "guidelines"]);
  assert.deepEqual((await topicsOf(namedIsprm)).sort(), ["guidelines", "isprm"]);
  assert.deepEqual(await topicsOf(noName), ["guidelines"]);
  assert.deepEqual((await topicsOf(iastm)).sort(), ["guidelines", "iastm"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`筋膜刀技术共识发布 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `筋膜刀技术共识发布 ${T}`, tags: ["筋膜刀"], fact: await fact(launch.id, "发布共识") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "iastm", name: "筋膜刀与软组织松解" }, { slug: "guidelines", name: "指南与共识" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `Cochrane 发布卒中康复系统综述更新 ${T}`, subjects: ["cochrane"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `Cochrane 撤回的一篇系统综述 ${T}`, subjects: ["cochrane"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("cochrane");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "cochrane")!;
  assert.equal(summary.latest?.title, `Cochrane 发布卒中康复系统综述更新 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("modalities");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("modalities", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["field", "technique", "population", "genre", "organization"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
