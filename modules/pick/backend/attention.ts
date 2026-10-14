// 阅读热度：公众号文章在微信里的阅读量（极致了随列表返回，不额外计费），折算成与「独立来源」同尺度的
// 热度，喂给框架的 hotAttention 插口（events/hot.ts）。康复领域跨源同题少，只按来源数凑不满热点榜；
// 读者规模是更贴合「热度」的证据。
//
// 映射取对数：1000 阅读＝0（不计），1 万＝1，10 万＝2 个来源当量，上限 3。量级差太大，线性折算会让
// 一篇爆款压掉所有多来源事件；千次以下不计，否则榜单退化成「最新动态」。极致了把 10 万以上的阅读量
// 统一返回 100001，展示上如实写成「10万+」，数值上按 10 万算。
import { sql } from "@aihot/backend/db";
import type { HotAttention } from "@aihot/backend/modules";

/** 千次以下不计：低于这个量级说明只是发出来了，不是有人在看。 */
const MIN_READ = 1000;
/** 单条事件最高加 3 个来源当量：再多也该由「有多少家在说」来区分。 */
const MAX_VALUE = 3;
/** 极致了对 10 万以上的阅读量统一返回这个值。 */
const CAPPED_READ = 100001;

function note(read: number): string {
  if (read >= CAPPED_READ) return "阅读 10万+";
  if (read >= 10000) return `阅读 ${Math.round(read / 1000) / 10}万`;
  return `阅读 ${read}`;
}

/** 一个事件里被读得最多的一篇（取各报道的最大值），按上面的映射给热度。 */
export const readAttention: HotAttention = async ({ stories }) => {
  const out = new Map<number, { value: number; note: string }>();
  if (stories.length === 0) return out;
  const rows = await sql<{ story_id: number; read: number }[]>`
    SELECT f.story_id, max((a.raw->'dajiala'->>'read')::int) AS read
    FROM stories st JOIN facts f ON f.story_id = st.id
    JOIN fact_articles fa ON fa.fact_id = f.id
    JOIN articles a ON a.id = fa.article_id
    JOIN publications p ON p.article_id = a.id
    WHERE st.id = ANY(${stories}::bigint[]) AND st.merged_into IS NULL AND a.raw ? 'dajiala'
      AND coalesce(p.visibility, 'public') <> 'withdrawn'
    GROUP BY f.story_id`;
  for (const row of rows) {
    const read = Number(row.read);
    if (!Number.isFinite(read) || read < MIN_READ) continue;
    out.set(Number(row.story_id), { value: Math.min(MAX_VALUE, Math.log10(read) - 3), note: note(read) });
  }
  return out;
};
