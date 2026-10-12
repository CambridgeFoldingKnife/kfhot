// 自动选题的读取与分桶。只读公开读取层（publication/scope 的 listedCondition），
// 按「首个主题标签」分桶后跨桶轮转，每个选题给一条主素材（同一桶还有时附一条次素材）。
import { sql } from "@aihot/backend/db";
import { CATEGORY_TAGS } from "@aihot/industry/taxonomy";
import { listedCondition } from "@aihot/backend/publication/scope";

export interface PickItem {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  tags: string[];
}

export interface Pick {
  topic: string;
  direction: string;
  source: string;
  url: string;
  items: PickItem[];
}

export interface PickResult {
  date: string;
  days: number;
  count: number;
  topic: string | null;
  picks: Pick[];
}

interface Row {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  tags: string[];
  source: string;
}

/** 分类标签不算主题：一篇文章的主题是它剩下的标签里的第一个。 */
const CATEGORY = new Set<string>(CATEGORY_TAGS);
export function topicOf(tags: readonly string[]): string {
  return tags.find((t) => !CATEGORY.has(t)) ?? "(综合)";
}

/** 窗口内最新的一批已上架内容，供分桶。 */
export async function loadCandidates(days: number, now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - days * 86400_000);
  return sql<Row[]>`
    SELECT p.article_id AS id, p.title, p.summary, p.url, p.tags, s.name AS source
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(now)} AND p.timeline_at >= ${since} AND p.timeline_at <= ${now}
    ORDER BY p.timeline_at DESC
    LIMIT 200`;
}

/** 跨桶轮转：先每桶取一条，桶空了就跳过；「(综合)」排在最后。 */
export function roundRobin(rows: readonly Row[], count: number): Pick[] {
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const key = topicOf(r.tags);
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  const order = [...buckets.keys()].sort((a, b) => (a === "(综合)" ? 1 : 0) - (b === "(综合)" ? 1 : 0));

  const picks: Pick[] = [];
  const hasLeft = () => order.some((k) => buckets.get(k)!.length > 0);
  for (let i = 0; picks.length < count && hasLeft(); i += 1) {
    const key = order[i % order.length]!;
    const list = buckets.get(key)!;
    if (list.length === 0) continue;
    const main = list.shift()!;
    const extra = list.shift();
    picks.push({
      topic: key,
      direction: `围绕近期素材展开：${main.title.slice(0, 40)}${main.title.length > 40 ? "…" : ""}`,
      source: main.source,
      url: main.url,
      items: [main, ...(extra ? [extra] : [])].map((r) => ({ id: r.id, title: r.title, url: r.url, summary: r.summary, tags: r.tags })),
    });
  }
  return picks;
}

export async function buildPicks(opts: { count: number; days: number; topic?: string | null }, now = new Date()): Promise<PickResult> {
  let rows = await loadCandidates(opts.days, now);
  if (opts.topic) rows = rows.filter((r) => r.tags.includes(opts.topic!));
  const picks = roundRobin(rows, opts.count);
  return {
    date: now.toISOString().slice(0, 10),
    days: opts.days,
    count: picks.length,
    topic: opts.topic ?? null,
    picks,
  };
}
