// 选题供料的两个对外出口，都是公开只读 GET（AGENTS：公开接口匿名，无需 token）：
//   GET /api/v1/pick      自动选题包（按主题轮转，来自公开精选/动态）
//   GET /api/v1/materials 素材榜（公众号文章按阅读/点赞排序，给内部选题与洗稿找灵感）
//   + 两个 agent 能力（/api/v1/agent/pick、/api/v1/agent/materials）与对应 MCP 工具。
// 另外把公众号阅读量喂给热点榜（hotAttention，backend/attention.ts）。
// 能力写成 agent.abilities 后会被 /api/v1/agent 指南、/llms.txt 和 MCP 工具集三处自动收录，
// 不需要手改 site/public/openapi-v1.json（那份是框架的静态产物，手改会掺行尾、且与上游合并冲突）。
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { buildPicks, type PickResult } from "./backend/pick.ts";
import { buildMaterials, renderMaterials, type MaterialSort } from "./backend/materials.ts";
import { readAttention } from "./backend/attention.ts";

const PICK_INPUT = z.object({
  count: z.number().int().min(1).max(50).optional().describe("选题条数，1–50，默认 10"),
  days: z.number().int().min(1).max(90).optional().describe("回看天数，1–90，默认 7"),
  topic: z.string().optional().describe("只要某个主题；省略则跨主题轮转"),
});

const MATERIALS_INPUT = z.object({
  days: z.number().int().min(1).max(90).optional().describe("回看天数，1–90，默认 30"),
  limit: z.number().int().min(1).max(100).optional().describe("条数，1–100，默认 30"),
  sort: z.enum(["read", "zan", "recent"]).optional().describe("排序：read 阅读量（默认）、zan 点赞、recent 时间"),
  source: z.string().optional().describe("只看某个公众号信源 id，例如 mp-rehab-med"),
});

const CACHE = "public, max-age=60, s-maxage=60, must-revalidate";

const intIn = (v: string | undefined, lo: number, hi: number, dflt: number) =>
  v === undefined || v === "" ? dflt : /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null;

/** 给人和 agent 看的一小段 Markdown。 */
function render(r: PickResult): string {
  if (r.picks.length === 0) {
    return `最近 ${r.days} 天内没有可用于选题的公开内容。稍后再试，或把 days 调大。`;
  }
  const lines = [`最近 ${r.days} 天的 ${r.picks.length} 个选题（每个含方向与素材链接）：`, ""];
  for (const p of r.picks) {
    lines.push(`- **${p.topic}** — ${p.direction}（来源：${p.source}）`);
    for (const it of p.items) lines.push(`  - [${it.title}](${it.url})${it.summary ? ` — ${it.summary.slice(0, 80)}` : ""}`);
  }
  return lines.join("\n");
}

const pickArgs = (args: Record<string, unknown>) => {
  const a = PICK_INPUT.parse(args);
  return { count: a.count ?? 10, days: a.days ?? 7, topic: a.topic?.trim() || null };
};

const materialArgs = (args: Record<string, unknown>) => {
  const a = MATERIALS_INPUT.parse(args);
  return { days: a.days ?? 30, limit: a.limit ?? 30, sort: (a.sort ?? "read") as MaterialSort, sourceId: a.source?.trim() || null };
};

export const pickServerModule = defineServerModule({
  name: "pick",
  // 热点榜的阅读热度：公众号阅读量折成来源当量（backend/attention.ts）。
  hotAttention: readAttention,
  http(app: FastifyInstance) {
    app.get("/api/v1/pick", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const count = intIn(q.count, 1, 50, 10);
      const days = intIn(q.days, 1, 90, 7);
      if (count === null || days === null) {
        return reply.code(400).send({ error: "invalid_request", detail: "count 须为 1–50、days 须为 1–90 的整数。" });
      }
      return reply.header("cache-control", CACHE).send(await buildPicks({ count, days, topic: q.topic?.trim() || null }));
    });

    app.get("/api/v1/materials", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const days = intIn(q.days, 1, 90, 30);
      const limit = intIn(q.limit, 1, 100, 30);
      const sort = q.sort ?? "read";
      if (days === null || limit === null || !["read", "zan", "recent"].includes(sort)) {
        return reply.code(400).send({ error: "invalid_request", detail: "days 1–90、limit 1–100、sort ∈ read|zan|recent。" });
      }
      return reply.header("cache-control", CACHE).send(
        await buildMaterials({ days, limit, sort: sort as MaterialSort, sourceId: q.source?.trim() || null }),
      );
    });
  },
  agent: {
    abilities: [
      {
        path: "/pick",
        title: "自动选题",
        ask: "给我几个可以写的选题，带方向与素材链接",
        answer: async () => render(await buildPicks({ count: 10, days: 7 })),
        etagPrefix: "pick",
        cacheControl: CACHE,
        mcp: {
          tool: "pick_topics",
          use: "选题（要写什么，带素材链接）",
          description:
            "Get ready-to-write topic packages: each pick carries a theme, a suggested angle, and one or two source items with links and summaries. Use this when the user asks what to write about rather than for a list of news.",
          input: PICK_INPUT,
          run: async (args) => {
            const result = await buildPicks(pickArgs(args));
            return { text: render(result), structured: result as unknown as Record<string, unknown> };
          },
        },
      },
      {
        path: "/materials",
        title: "素材榜",
        ask: "公众号里哪些文章阅读/点赞高，可以拿来找灵感",
        answer: async () => renderMaterials(await buildMaterials({ days: 30, limit: 30, sort: "read", sourceId: null })),
        etagPrefix: "materials",
        cacheControl: CACHE,
        mcp: {
          tool: "hot_materials",
          use: "素材榜（公众号文章按阅读/点赞排序）",
          description:
            "List WeChat official-account posts collected in the last N days, with their read and like counts, sorted by engagement. Use this to see what is popular among rehab accounts — for finding angles and inspiration, not for editorial selection.",
          input: MATERIALS_INPUT,
          run: async (args) => {
            const result = await buildMaterials(materialArgs(args));
            return { text: renderMaterials(result), structured: result as unknown as Record<string, unknown> };
          },
        },
      },
    ],
  },
  llms: () => ({
    api: [
      "`/api/v1/pick` 自动选题包（主题+方向+素材链接，供写作流水线取用）",
      "`/api/v1/materials` 素材榜（公众号文章按阅读/点赞排序，找选题灵感）",
    ],
  }),
});
