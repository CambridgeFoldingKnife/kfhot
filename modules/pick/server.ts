// 自动选题的对外出口：GET /api/v1/pick 与一个 agent 能力（/api/v1/agent/pick + MCP 工具）。
// 能力写成 agent.abilities 后，会被 /api/v1/agent 的指南、/llms.txt 和 MCP 的工具集三处自动收录，
// 不需要手改 site/public/openapi-v1.json（那份是框架的静态产物，手改会掺行尾、且与上游合并冲突）。
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { buildPicks, type PickResult } from "./backend/pick.ts";

const PICK_INPUT = z.object({
  count: z.number().int().min(1).max(50).optional().describe("选题条数，1–50，默认 10"),
  days: z.number().int().min(1).max(90).optional().describe("回看天数，1–90，默认 7"),
  topic: z.string().optional().describe("只要某个主题；省略则跨主题轮转"),
});

const CACHE = "public, max-age=60, s-maxage=60, must-revalidate";

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

const parseArgs = (args: Record<string, unknown>) => {
  const a = PICK_INPUT.parse(args);
  return { count: a.count ?? 10, days: a.days ?? 7, topic: a.topic?.trim() || null };
};

export const pickServerModule = defineServerModule({
  name: "pick",
  http(app: FastifyInstance) {
    app.get("/api/v1/pick", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const int = (v: string | undefined, lo: number, hi: number, dflt: number) =>
        v === undefined || v === "" ? dflt : /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null;
      const count = int(q.count, 1, 50, 10);
      const days = int(q.days, 1, 90, 7);
      if (count === null || days === null) {
        return reply.code(400).send({ error: "invalid_request", detail: "count 须为 1–50、days 须为 1–90 的整数。" });
      }
      const result = await buildPicks({ count, days, topic: q.topic?.trim() || null });
      return reply.header("cache-control", CACHE).send(result);
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
            const result = await buildPicks(parseArgs(args));
            return { text: render(result), structured: result as unknown as Record<string, unknown> };
          },
        },
      },
    ],
  },
  llms: () => ({ api: ["`/api/v1/pick` 自动选题包（主题+方向+素材链接，供写作流水线取用）"] }),
});
