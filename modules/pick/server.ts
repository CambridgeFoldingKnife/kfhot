// 自动选题的 HTTP 出口：GET /api/v1/pick。挂在框架的 v1 兜底之前（apps/api/src/app.ts）。
import type { FastifyInstance } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { buildPicks } from "./backend/pick.ts";

function intIn(value: string | undefined, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export const pickServerModule = defineServerModule({
  name: "pick",
  http(app: FastifyInstance) {
    app.get("/api/v1/pick", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const count = intIn(q.count, 10, 1, 50);
      const days = intIn(q.days, 7, 1, 90);
      if (count === null || days === null) {
        return reply.code(400).send({ error: "invalid_request", detail: "count 须为 1–50、days 须为 1–90 的整数。" });
      }
      const result = await buildPicks({ count, days, topic: q.topic?.trim() || null });
      return reply.header("cache-control", "public, max-age=60, s-maxage=60, must-revalidate").send(result);
    });
  },
});
