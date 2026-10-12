// gold 集（人工标注）工具：从库里分层抽样出待标注清单，标注后合成 eval-selection.ts 要的 JSONL。
//
// 用法（仓库根目录，已配 DATABASE_URL）：
//   node modules/quality/scripts/gold.ts build [--per-source 4] [--out .data/gold]
//       按来源分层抽样 → 写 <out>/cases.jsonl（含材料原文，gold 留空）+ <out>/待标注.csv（你填最后两列）
//   node modules/quality/scripts/gold.ts merge [--csv .data/gold/待标注.csv]
//       读回你填好的 CSV → 写 <out>/kfhot-gold.jsonl，供 eval-selection.ts 用
//
// ⚠️ 抽样时**不导出模型分数**：先看分再标会污染独立判断。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";

interface Article {
  id: string;
  title: string;
  source_id: string;
  source_name: string;
  kind: string;
  tier: string;
  first_party: boolean;
  published_at: Date | null;
  body: string | null;
  tags: string[] | null;
  category: string | null;
}

interface Case {
  caseId: string;
  material: { title: string; originalTitle: string | null; publishedAt: string | null; sourceName: string; bodyZh: string | null; bodyOriginal: string | null };
  sourceFacts: { sourceKind: string; sourceTier: string; firstParty: boolean; language: string | null };
  samplingContext: { benchmarkSplit: string; samplingStratum: string };
  gold: { decision: string };
}

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
const outDir = path.resolve(REPO_ROOT, arg("out", ".data/gold"));

/** 稳定分桶：同一 caseId 永远落在同一半，跑几次都一样。 */
const split = (id: string) => (Number.parseInt(id.slice(-3), 36) % 5 < 3 ? "development" : "holdout");

/** 粗判分层，只为人读时好归类，不参与评分。先看具体来源，再看信源种类——顺序反了会把政策归成论文。 */
const BY_SOURCE: Record<string, string> = {
  "json-gov-policy": "官方-政策",
  "web-21wecan-notice": "官方-资格考试",
  "web-medsci-rehab": "媒体-指南共识",
  "web-carm-news": "官方-机构",
  "web-bsu-news": "官方-机构",
  "rss-isprm": "官方-国际",
  "rss-who-news": "官方-国际",
};
function stratum(a: Article & { source_id: string; id: string }): string {
  if (a.kind === "mp_account") return a.tags?.includes("厂商") ? "公众号-厂商" : "公众号-媒体";
  if (BY_SOURCE[a.source_id]) return BY_SOURCE[a.source_id]!;
  if (a.source_id === "epmc-cochrane") return "研究-系统综述";
  if (a.kind === "json_list") return "研究-论文";
  return "其他";
}

async function build(): Promise<void> {
  const per = Number(arg("per-source", "4"));
  const rows = await sql<Article[]>`
    SELECT a.id, a.title, a.source_id, s.name AS source_name, s.kind, s.tier, s.first_party,
           a.published_at, coalesce(nullif(a.body_text,''), a.excerpt) AS body, an.tags, an.category
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN analyses an ON an.article_id = a.id AND an.id = (SELECT max(id) FROM analyses WHERE article_id = a.id)
    ORDER BY a.source_id, a.published_at DESC NULLS LAST, a.id`;

  const bySource = new Map<string, Article[]>();
  for (const r of rows) (bySource.get(r.source_id) ?? bySource.set(r.source_id, []).get(r.source_id)!).push(r);

  const cases: Case[] = [];
  let n = 0;
  for (const [sourceId, list] of bySource) {
    for (const a of list.slice(0, per)) {
      n += 1;
      const caseId = `g${String(n).padStart(3, "0")}`;
      const body = a.body?.trim() || null;
      cases.push({
        caseId,
        material: {
          title: a.title, originalTitle: a.title,
          publishedAt: a.published_at ? a.published_at.toISOString() : null,
          sourceName: a.source_name, bodyZh: null, bodyOriginal: body,
        },
        sourceFacts: { sourceKind: a.kind, sourceTier: a.tier, firstParty: a.first_party, language: null },
        samplingContext: { benchmarkSplit: split(caseId), samplingStratum: stratum(a) },
        gold: { decision: "" },
      });
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n");

  // 给人填的表：**真正的 CSV**（逗号分隔 + RFC4180 引号包裹 + BOM）。
  // ⚠️ 不能用 tab 分隔却命名 .csv —— Excel 按逗号切，而英文摘要逗号密集，会整行错位。
  // 两列判断紧跟标题，长文本放最后，一屏看完短列；merge 按表头名字取列，重排也不会错。
  const cell = (s: string) => `"${s.replace(/\r?\n/g, " ⏎ ").replace(/"/g, '""')}"`;
  const head = ["#", "档", "类型", "来源", "标题", "判断", "打分", "原文/摘要"];
  const lines = [head.map(cell).join(",")];
  for (const c of cases) {
    lines.push([
      c.caseId, c.sourceFacts.sourceTier, c.samplingContext.samplingStratum, c.material.sourceName,
      c.material.title, "", "", c.material.bodyOriginal ?? "（无正文，仅标题）",
    ].map(cell).join(","));
  }
  writeFileSync(path.join(outDir, "gold-待标注.csv"), "\ufeff" + lines.join("\r\n") + "\r\n");

  const byStratum = cases.reduce((m, c) => ({ ...m, [c.samplingContext.samplingStratum]: (m[c.samplingContext.samplingStratum] ?? 0) + 1 }), {} as Record<string, number>);
  const dev = cases.filter((c) => c.samplingContext.benchmarkSplit === "development").length;
  console.log(`cases: ${cases.length}（development ${dev} / holdout ${cases.length - dev}），覆盖 ${bySource.size} 个源`);
  console.log("分层:", JSON.stringify(byStratum, null, 1));
  console.log(`→ ${path.join(outDir, "cases.jsonl")}`);
  console.log(`→ ${path.join(outDir, "gold-待标注.csv")}   ← 你填「判断」列（必填）与「打分」列（选填）`);
}

/** RFC4180 解析：支持引号包裹、字段内逗号与双写引号（"→""）。Excel 存出来的 CSV 就是这样。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function merge(): Promise<void> {
  const csv = path.resolve(REPO_ROOT, arg("csv", ".data/gold/待标注.csv"));
  const cases = readFileSync(path.join(outDir, "cases.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Case);
  const byId = new Map(cases.map((c) => [c.caseId, c]));
  const rows = parseCsv(readFileSync(csv, "utf8").replace(/^\ufeff/, "")).filter((r) => r.some((c) => c.trim()));
  const bad: string[] = [];
  let filled = 0, scored = 0;
  // 按表头名字找列，不靠位置：以后重排或加列都不会读错。
  const head = rows[0] ?? [];
  const col = (prefix: string, fallback: number) => {
    const i = head.findIndex((h) => h.trim().startsWith(prefix));
    return i >= 0 ? i : fallback;
  };
  const C_ID = col("#", 0), C_DEC = col("判断", 5), C_SCORE = col("打分", 6);
  for (const cells of rows.slice(1)) {
    const id = cells[C_ID]?.trim() ?? "";
    const decision = (cells[C_DEC] ?? "").trim().toLowerCase();
    const score = (cells[C_SCORE] ?? "").trim();
    const c = byId.get(id);
    if (!c) { if (id) bad.push(`${id}: 没有这个 caseId`); continue; }
    if (!["select", "reject", "either"].includes(decision)) { if (decision) bad.push(`${id}: 判断须是 select/reject/either，实际填了「${decision}」`); continue; }
    c.gold.decision = decision;
    if (score) {
      const n = Number(score);
      if (!Number.isFinite(n) || n < 0 || n > 100) bad.push(`${id}: 打分须是 0–100，实际「${score}」`);
      else { (c as unknown as { goldScore: number }).goldScore = n; scored += 1; }
    }
    filled += 1;
  }
  const missing = cases.filter((c) => !c.gold.decision).map((c) => c.caseId);
  writeFileSync(path.join(outDir, "kfhot-gold.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  console.log(`已填 ${filled}/${cases.length}，其中打了分 ${scored}`);
  if (missing.length) console.log(`⚠️ 未填判断 ${missing.length} 条（会按 either 之外的缺失跳过）：${missing.slice(0, 12).join(" ")}${missing.length > 12 ? " …" : ""}`);
  if (bad.length) console.log(`⚠️ 有问题的行 ${bad.length}：\n  ` + bad.slice(0, 10).join("\n  "));
  console.log(`→ ${path.join(outDir, "kfhot-gold.jsonl")}   跑：node --env-file=.env scripts/eval-selection.ts --gold .data/gold/kfhot-gold.jsonl`);
}

try {
  const cmd = process.argv[2];
  if (cmd === "build") await build();
  else if (cmd === "merge") await merge();
  else { console.log("用法: gold.ts build|merge"); process.exitCode = 1; }
} finally {
  await closeDb();
}
