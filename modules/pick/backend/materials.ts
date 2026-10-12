// 素材榜：公众号文章的阅读/点赞（极致了随列表返回，不额外计费），供内部选题与洗稿找灵感。
// 与「公开精选」是两条轨：这里按互动量排序，不看评分；只排除已撤下的条目。
// 模块路由不在 apps/api/src/routes 下，所以不受「公开路由只读 publication/」那条架构约束；
// 但仍遵守它的精神——只读、不写任何受管表。
import { sql } from "@aihot/backend/db";

export interface Material {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  read: number | null;
  zan: number | null;
  summary: string | null;
}

export interface MaterialsResult {
  days: number;
  sort: string;
  count: number;
  items: Material[];
}

const SORTS = { read: "readDesc", zan: "zanDesc", recent: "timelineDesc" } as const;
export type MaterialSort = keyof typeof SORTS;

export async function buildMaterials(
  opts: { days: number; limit: number; sort: MaterialSort; sourceId?: string | null },
  now = new Date(),
): Promise<MaterialsResult> {
  const since = new Date(now.getTime() - opts.days * 86400_000);
  const order = opts.sort === "zan"
    ? sql`(a.raw->'dajiala'->>'zan')::int DESC NULLS LAST`
    : opts.sort === "recent" ? sql`a.discovered_at DESC` : sql`(a.raw->'dajiala'->>'read')::int DESC NULLS LAST`;
  const filter = opts.sourceId ? sql`AND a.source_id = ${opts.sourceId}` : sql``;

  const rows = await sql<{ id: string; title: string; url: string; source: string; published_at: Date | null; read: number | null; zan: number | null; summary: string | null }[]>`
    SELECT a.id, a.title, a.url, s.name AS source, a.published_at,
           (a.raw->'dajiala'->>'read')::int AS read, (a.raw->'dajiala'->>'zan')::int AS zan,
           coalesce(nullif(a.body_text, ''), a.excerpt) AS summary
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN publications p ON p.article_id = a.id
    WHERE s.kind = 'mp_account' AND coalesce(p.visibility, '') <> 'withdrawn'
      AND a.discovered_at >= ${since} ${filter}
    ORDER BY ${order}, a.id DESC
    LIMIT ${opts.limit}`;

  return {
    days: opts.days,
    sort: SORTS[opts.sort],
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id, title: r.title, url: r.url, source: r.source,
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      read: r.read, zan: r.zan, summary: r.summary,
    })),
  };
}

/** 给人与 agent 看的一小段 Markdown。 */
export function renderMaterials(r: MaterialsResult): string {
  if (r.items.length === 0) return `最近 ${r.days} 天内没有公众号素材。稍后再试，或把 days 调大。`;
  const lines = [`最近 ${r.days} 天的公众号素材 ${r.items.length} 条（按${r.sort === "readDesc" ? "阅读" : r.sort === "zanDesc" ? "点赞" : "时间"}排）：`, ""];
  for (const m of r.items) {
    lines.push(`- [${m.title}](${m.url}) — ${m.source}｜阅读 ${m.read ?? "?"}｜点赞 ${m.zan ?? "?"}`);
    if (m.summary) lines.push(`  ${m.summary.slice(0, 90)}`);
  }
  return lines.join("\n");
}
