// 质检工具（P5）：不调模型、只读库，给「三方向 × 五层」与召回率提供可复算的数字。
//
// 用法（在仓库根目录、已配好 DATABASE_URL）：
//   node modules/quality/scripts/qc.ts baseline [--kfhot ../kfhot/data/kfhot.db] [--out .data/qc/kfhot-baseline.jsonl]
//       把旧站(kfhot v1 SQLite)的已知条目导成基准集，供 Q1/Q2 用。
//   node modules/quality/scripts/qc.ts recall <baseline.jsonl>
//       Q1 召回率：基准集里有多少条在新站库里找得到（按身份键），列出抓不到的条目。
//   node modules/quality/scripts/qc.ts matrix
//       Q3 覆盖度：按「分类 × 信源种类」出计数矩阵，暴露空格。
//
// 不进任何公开出口、不写库。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { identityKeyForUrl } from "@aihot/backend/lib/url";

interface BaselineRow {
  id: number;
  title: string;
  url: string;
  tier: string | null;
  ai_score: number | null;
  published_at: string | null;
  topic_tags: string | null;
}

/** Q1/Q2 的基准集：旧站的已知内容（标题 + 原文链接 + 旧评分）。 */
function baseline(file: string, out: string): void {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT id, title, url, tier, ai_score, published_at, topic_tags FROM item ORDER BY id").all() as unknown as BaselineRow[];
  db.close();
  const withUrl = rows.filter((r) => r.url && identityKeyForUrl(r.url));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, withUrl.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`baseline: ${withUrl.length} 条（共 ${rows.length}，缺可用 url 的 ${rows.length - withUrl.length} 条）→ ${out}`);
}

/** 标题归一：小写、压空白、去尾部的点。同一篇论文在不同库里标题应一致，URL 未必（旧站存 DOI，新站存 EPMC 链接）。 */
const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();

/**
 * Q1：基准集在新站库里的召回率。**按 URL 身份键 或 标题**任一命中即算召回——
 * 只按 URL 会低估：旧站存的是 DOI，新站存的是收录页链接，同一篇论文两个地址。
 */
async function recall(file: string): Promise<void> {
  const rows = readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as BaselineRow);
  const keys = rows.map((r) => identityKeyForUrl(r.url)).filter((k): k is string => k !== null);
  const byKey = new Set((await sql<{ identity_key: string }[]>`
    SELECT DISTINCT identity_key FROM articles WHERE identity_key IN ${sql(keys)}`).map((r) => r.identity_key));
  const byTitle = new Set((await sql<{ title: string }[]>`SELECT title FROM articles`).map((r) => normTitle(r.title)));

  const missing = rows.filter((r) => {
    const k = identityKeyForUrl(r.url);
    return !(k && byKey.has(k)) && !byTitle.has(normTitle(r.title));
  });
  const hit = rows.length - missing.length;
  const rate = rows.length ? (hit / rows.length) * 100 : 0;
  console.log(`Q1 召回率: ${hit}/${rows.length} = ${rate.toFixed(1)}%（目标 首轮≥70% / 补齐≥90%）`);
  console.log(`  其中按 URL 命中 ${rows.filter((r) => { const k = identityKeyForUrl(r.url); return k && byKey.has(k); }).length} 条，其余靠标题命中`);
  if (missing.length) {
    console.log(`抓不到 ${missing.length} 条（逐条归因：源没接 / 检索式不覆盖 / 限流）：`);
    for (const m of missing.slice(0, 40)) console.log(`  - [${m.tier ?? "?"}] ${String(m.title).slice(0, 72)}`);
    if (missing.length > 40) console.log(`  … 其余 ${missing.length - 40} 条见基准集文件`);
  }
}

/** Q3：分类 × 信源种类的计数。空格 = 该方向上缺源。 */
async function matrix(): Promise<void> {
  const rows = await sql<{ category: string | null; kind: string; n: number }[]>`
    SELECT p.category, s.kind, count(*)::int AS n
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.visibility = 'public' GROUP BY 1, 2 ORDER BY 1, 2`;
  if (rows.length === 0) {
    console.log("publications 为空：还没有内容跑完模型链路（采集不等于上架），先让 worker 跑一轮再看。");
    return;
  }
  const cats = [...new Set(rows.map((r) => r.category ?? "(未分类)"))].sort();
  const kinds = [...new Set(rows.map((r) => r.kind))].sort();
  const at = (c: string, k: string) => rows.find((r) => (r.category ?? "(未分类)") === c && r.kind === k)?.n ?? 0;
  console.log(["分类".padEnd(14), ...kinds.map((k) => k.padStart(12))].join(""));
  for (const c of cats) console.log([c.padEnd(14), ...kinds.map((k) => String(at(c, k)).padStart(12))].join(""));
  const empty = cats.flatMap((c) => kinds.filter((k) => at(c, k) === 0).map((k) => `${c}×${k}`));
  console.log(`\n空格 ${empty.length} 个${empty.length ? "：" + empty.join(" / ") : ""}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
};

try {
  if (cmd === "baseline") {
    baseline(path.resolve(REPO_ROOT, flag("kfhot", "../kfhot/data/kfhot.db")), path.resolve(REPO_ROOT, flag("out", ".data/qc/kfhot-baseline.jsonl")));
  } else if (cmd === "recall") {
    const file = rest.find((a) => !a.startsWith("--")) ?? flag("gold", ".data/qc/kfhot-baseline.jsonl");
    await recall(path.resolve(REPO_ROOT, file));
  } else if (cmd === "matrix") {
    await matrix();
  } else {
    console.log("用法: node modules/quality/scripts/qc.ts baseline|recall <file>|matrix");
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
