// Heat is counted from the evidence as it stands: a withdrawn report no longer counts and a source
// counts in its current role; participants are independent actors (one company's channels are one,
// every Hacker News author is one); the change compares with the earlier time's full 48-hour window,
// and a source added since then is left out of the comparison.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { computeHotRanking, heatRows, snapshotHeat, type HotEntry } from "@aihot/backend/events/hot";
import { installModules } from "@aihot/backend/modules";

const T = `hot-${tag()}`;
const AT = new Date("2099-03-01T12:00:00Z");
const H = 3600_000;

after(closeDb);

async function source(key: string, opts: { mode?: string; owner?: string; createdAt?: Date } = {}) {
  const id = `${T}-${key}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, owner_entity_id, created_at, next_fetch_at)
            VALUES (${id}, ${id}, 'rss', 'T2', ${opts.mode ?? "editorial"}, ${opts.owner ?? null}, ${opts.createdAt ?? new Date("2099-01-01")}, '2100-01-01')`;
  return id;
}

let n = 0;
async function signal(story: number, sourceId: string, hoursBefore: number, opts: { author?: string; kind?: string; withdrawn?: boolean; role?: string | null; composite?: boolean; standalone?: boolean } = {}) {
  n += 1;
  const id = `${T}-a${n}`;
  const at = new Date(AT.getTime() - hoursBefore * H);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, author, discovered_at, timeline_at)
            VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${id}, ${opts.author ?? null}, ${at}, ${at})`;
  const [analysis] = await sql`INSERT INTO analyses (article_id,input_revision,origin,output)
    VALUES (${id},1,'rule',${sql.json({scope:opts.composite ? 'composite' : 'single'})}) RETURNING id`;
  await sql`INSERT INTO publications (article_id, analysis_id, revision, visibility, eligible, selected, title, source_id, channel, first_party, url, discovered_at, timeline_at, body_mode, sort_at)
    VALUES (${id}, ${analysis!.id}, 1, ${opts.withdrawn ? 'withdrawn' : 'public'}, true, false, ${id}, ${sourceId}, 'news', false, ${`https://example.org/${id}`}, ${at}, ${at}, 'summary', ${at})`;
  if (opts.role !== null) {
    const [f] = await sql`INSERT INTO facts (public_id,story_id,title) VALUES (${id},${story},${id}) RETURNING id`;
    await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${f!.id},${id},${opts.role ?? 'report'})`;
  }
  if (opts.standalone) await sql`INSERT INTO grouping_overrides (article_id,mode,reason) VALUES (${id},'standalone','Reviewed independent roundup')`;
  // The stored key and kind are what the grouping wrote at the time; heat reads the current ones.
  await sql`INSERT INTO story_signals (story_id, article_id, participant_key, source_id, kind, observed_at)
            VALUES (${story}, ${id}, ${`source:${sourceId}`}, ${sourceId}, ${opts.kind ?? "editorial"}, ${at})`;
  return id;
}

async function story() {
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, ${T}) RETURNING id`;
  return s!.id;
}
const rowOf = async (id: number, at = AT) => (await heatRows(at)).find((r) => Number(r.story_id) === id);

test("editorial heat follows factual membership; signal-only evidence survives without a fact", async () => {
  const s = await story();
  const report = await signal(s, await source('member'), 1);
  await signal(s, await source('mention'), 1, {role:'mention'});
  await signal(s, await source('orphan'), 1, {role:null});
  await signal(s, await source('composite'), 1, {composite:true});
  await signal(s, await source('signal-only', {mode:'hot_signal'}), 1, {role:null,kind:'signal'});
  await signal(s, await source('independent-signal', {mode:'hot_signal'}), 1, {role:null,kind:'signal',standalone:true});
  await signal(s, await source('independent-report'), 1, {standalone:true});
  const before = await rowOf(s);
  assert.deepEqual([Number(before?.participants),Number(before?.editorial_participants),Number(before?.signal_participants)],[2,1,1]);
  const moved = await story();
  await sql`UPDATE facts SET story_id=${moved} WHERE id IN (SELECT fact_id FROM fact_articles WHERE article_id=${report})`;
  const after = await rowOf(s);
  assert.deepEqual([Number(after?.participants),Number(after?.editorial_participants),Number(after?.signal_participants)],[1,0,1]);
  assert.equal((await sql`SELECT 1 FROM story_signals WHERE story_id=${s}`).length,7,'stale evidence is retained for audit');
});

test("withdrawn reports and changed roles are counted as they stand now", async () => {
  const s = await story();
  await signal(s, await source("a"), 1);
  await signal(s, await source("b"), 1, { withdrawn: true });
  await signal(s, await source("c", { mode: "hot_signal" }), 1, { kind: "editorial" }); // since demoted
  await signal(s, await source("d", { mode: "isolated" }), 1);
  const r = await rowOf(s);
  assert.equal(Number(r?.participants), 2, "a and c; the withdrawn report and the isolated source are out");
  assert.equal(Number(r?.editorial_participants), 1);
  assert.equal(Number(r?.signal_participants), 1);
});

test("one company's channels are one participant; every community author is one", async () => {
  const s = await story();
  await signal(s, await source("owner-x", { owner: `acme-${T}` }), 2);
  await signal(s, await source("owner-y", { owner: `acme-${T}` }), 2);
  // The real community feeds are named in the code; a test source stands for none of them, so here the
  // authors of one ordinary feed stay one participant.
  const feed = await source("feed");
  await signal(s, feed, 2, { author: "alice" });
  await signal(s, feed, 2, { author: "bob" });
  const r = await rowOf(s);
  assert.equal(Number(r?.participants), 2);
});

test("publisher attribution repairs participant identity without rewriting stored evidence", async () => {
  const s = await story();
  const publisher = await source('verified-publisher', {owner:`publisher-${T}`});
  const discovery = await source('aggregator');
  await signal(s, publisher, 2);
  const corrected = await signal(s, discovery, 1);
  assert.equal(Number((await rowOf(s))?.participants),2);
  await sql`UPDATE articles SET source_id=${publisher} WHERE id=${corrected}`;
  assert.equal(Number((await rowOf(s))?.participants),1,'the same publisher is one participant after provenance repair');
  assert.equal((await sql`SELECT source_id FROM story_signals WHERE article_id=${corrected}`)[0]!.source_id,discovery,'the original evidence remains auditable');
});

test("the change compares with the earlier time's full 48-hour window, without sources added since", async () => {
  const s = await story();
  await signal(s, await source("now-1"), 1);
  await signal(s, await source("now-2"), 1);
  // Seen 50 hours ago only: outside the current window, inside the one six hours earlier.
  await signal(s, await source("old"), 50);
  const r = await rowOf(s);
  assert.equal(Number(r?.participants), 2);
  assert.ok(Number(r?.heat_prev) > 0, "the earlier window keeps its first six hours");

  const t = await story();
  const steady = await source("steady");
  await signal(t, steady, 2);
  await signal(t, steady, 8);
  await signal(t, await source("added", { createdAt: new Date(AT.getTime() - 3 * H) }), 1);
  const u = await rowOf(t);
  assert.equal(Number(u?.participants), 2);
  assert.equal(Number(u?.uncomparable), 1, "the source added three hours ago is left out of the change");
  assert.ok(Number(u?.heat_obs) < Number(u?.heat));
});

// Snapshot batching must keep incomplete-hour repair, upsert idempotency and corrected cohort
// counts.
test("hourly snapshots are idempotent and repair an incomplete hour after collection catches up", async () => {
  const s = await story();
  const src = await source("snapshot");
  await signal(s, src, 2);
  await snapshotHeat(AT);
  assert.equal((await sql`SELECT complete FROM story_heat_hourly WHERE story_id = ${s} AND hour = ${AT}`)[0]!.complete, false);
  await sql`UPDATE sources SET last_ok_at = ${new Date(+AT + H)} WHERE id = ${src}`;
  await snapshotHeat(new Date(+AT + H));
  await snapshotHeat(new Date(+AT + H));
  const rows = await sql`SELECT hour, complete, participants FROM story_heat_hourly WHERE story_id = ${s} ORDER BY hour`;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.complete && r.participants === 1));
});

// A site's own attention (a module's hotAttention: readers, votes) joins the heat, and lets a story
// with one source into the ranking: in a field where separate sources rarely cover one event, reader
// attention is the evidence there is.
test("a module's own attention enters the ranking and a single-source story on its strength", async () => {
  const s = await story();
  await signal(s, await source("attention"), 1);
  /** The entries written by one ranking run, and the evidence beside them. */
  const rankNow = async () => {
    const [mark] = await sql<{ id: number }[]>`SELECT coalesce(max(id), 0) AS id FROM hot_rankings`;
    const markId = Number(mark!.id);
    await computeHotRanking(AT);
    const rows = await sql<{ entries: HotEntry[]; evidence: Record<string, unknown> }[]>`
      SELECT entries, evidence FROM hot_rankings WHERE id > ${markId} ORDER BY id DESC`;
    return { entries: rows.flatMap((r) => r.entries).filter((e) => e.storyId === s), evidence: rows[0]?.evidence ?? {} };
  };
  const asked: number[][] = [];
  const measuring = (value: number) => installModules([{
    name: "hot-attention-fixture",
    hotAttention: async ({ stories }) => { asked.push(stories); return new Map([[s, { value, note: "阅读 10万+" }]]); },
  }]);

  try {
    installModules([]);
    assert.equal((await rankNow()).entries.length, 0, "one participant is not corroboration");
    measuring(0);
    assert.equal((await rankNow()).entries.length, 0, "attention of zero is no evidence either");
    measuring(2);
    const { entries, evidence } = await rankNow();
    const entry = entries[0]!;
    assert.deepEqual([entry.sourceCount, entry.participantCount], [1, 1], "the entry keeps its own counts");
    assert.deepEqual(entry.attention, { value: 2, note: "阅读 10万+" });
    assert.ok(entry.heat > 20, "the index is the participants' heat plus the attention");
    assert.ok(asked.every((ids) => ids.includes(s)), "the module is asked about the candidates of this ranking");
    assert.equal(evidence.withAttention, 1);
  } finally {
    installModules([]);
  }
  assert.equal((await rankNow()).entries.length, 0, "without the module the story is out again");
});

test("an hour taken again updates the cohort after a source changes role", async () => {  const s = await story();
  const src = await source("cohort");
  const id = await signal(s, src, 2);
  const hour = new Date(Math.floor(Date.now() / H) * H);
  await sql`UPDATE story_signals SET observed_at = ${new Date(+hour - H)} WHERE article_id = ${id}`;
  await sql`UPDATE sources SET created_at = '2020-01-01', last_ok_at = ${new Date()} WHERE id = ${src}`;
  await snapshotHeat(hour);
  await sql`UPDATE sources SET participation_mode = 'hot_signal' WHERE id = ${src}`;
  await snapshotHeat(hour);
  const rows = await sql`SELECT participants, cohort FROM story_heat_hourly WHERE story_id = ${s}`;
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.participants === 1 && r.cohort === 0));
});
