// 看板的月度 AI 分析：把人已经算好的指标喂给模型，让它写「数据解读 + 行动建议」两段。
//
// 三条纪律（比框架月报更严，因为这里的输入几乎全是数字）：
//   1) 模型不做算术：环比、1/2/3 月窗口、复合月均都是 store.ts 算好后原样写进摘要，提示词明确禁止计算和外推。
//   2) 数字回声：输出里的数字必须能在输入里找到，找不到就判不可用 —— 不落库，看板照常显示表格。
//   3) 发布门：生成的是草稿，管理员在后台点「发布」才进公开页。
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { chatJson } from "@aihot/backend/providers/llm";
import { labelOf, loadReport } from "./store.ts";
import { METRIC_KEYS, METRIC_LABELS, PLATFORM_LABELS } from "../types.ts";
import type { AnalysisData, AnalysisRow, BoardReport, MetricKey, PublishedAnalysis } from "../types.ts";

export const ANALYSIS_VERSION = "board-analysis-v1";

const SYSTEM = `你是一家康复医疗公司的经营数据分析师。只根据用户给出的数字写分析，不允许自己计算、补全或外推任何数字。

输出一个 json 对象，三个字段：
- highlights：3–5 个「本月最该看的数」。每项 { label, value, change, tone }：label 是不超过 8 个字的名词（如「阅读/曝光」），value 原样照抄输入里的本期值，change 原样照抄输入里的对比值（带 + 或 −），tone 取 up / down / flat。不要在这里放输入里没有的数。
- reading：数据解读，2–3 段，段与段之间用真实换行分隔，每段 1–2 句；引用的每个数字必须原样出现在输入中，不要自己算增长率、不要换算、不要四舍五入到输入里没有的值。
- advice：3–5 条行动建议。**必须是 JSON 数组**，每个元素是一句完整的话，例如 ["……","……","……"]；不要把多条塞进一个字符串，也不要编号。

输入里标为「数据不足」的指标，就写数据不足，不要猜、不要用别的月份替代。语气克制、结论明确，不要空话。中文输出。`;

// 模型对 JSON 结构并不总是守规矩（把 advice 写成一整段字符串、highlights 少字段都遇到过），
// 所以 schema 只保证"能读出来"，归一化放在下面做，读不出来才判失败。
const TextOrList = z.union([z.array(z.string()), z.string()]);

const Schema = z.object({
  highlights: z
    .array(z.object({ label: z.string(), value: z.string(), change: z.string().optional(), tone: z.string().optional() }))
    .optional(),
  reading: TextOrList,
  advice: TextOrList.optional(),
});

/** 与页面一致的数字格式：≥100 取整，否则一位小数；没有值写「数据不足」。 */
const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "数据不足" : v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "数据不足" : `${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`);
const growth = (w: { gCompare: { kind: string; diff: number | null; pct: number | null } | null; g2: { kind: string; diff: number | null; pct: number | null } | null; g3: unknown; cagr: number | null } | undefined) => {
  if (!w) return "数据不足";
  const one = (g: { kind: string; diff: number | null; pct: number | null } | null) =>
    !g
      ? "数据不足"
      : g.kind === "ratio"
        ? `${g.diff! >= 0 ? "+" : "-"}${Math.abs(g.diff!).toFixed(1)}个百分点`
        : g.kind === "perk"
          ? `${g.diff! >= 0 ? "+" : "-"}${Math.abs(g.diff!).toFixed(2)} 个/千阅读`
          : `${g.pct! >= 0 ? "+" : "-"}${pct(g.pct)}`;
  return `较基准 ${one(w.gCompare)}；较 2 月前 ${one(w.g2 as never)}；较 3 月前 ${one(w.g3 as never)}；月均 ${w.cagr === null ? "数据不足" : `${pct(w.cagr)}`}`;
};

/** 把一期的报表压成模型能读的摘要：数字全部已经算好，模型只负责组织语言。 */
export function digest(report: BoardReport): string {
  const lines: string[] = [];
  lines.push(`本月：${report.label}（${report.month}）；对比基准：${labelOf(report.base)}`);
  lines.push(`已有月份：${report.months.join("、")}`);
  if (report.missingPlatforms.length) lines.push(`注意：本月缺少平台 ${report.missingPlatforms.map((p) => PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] ?? p).join("、")}（上月有、本月未上传），不参与环比。`);
  if (report.missingAccounts.length) lines.push(`注意：上月有、本月没有的账号：${report.missingAccounts.map((a) => `${a.account}(${PLATFORM_LABELS[a.platform as keyof typeof PLATFORM_LABELS] ?? a.platform})`).join("、")}。`);

  for (const scope of ["total", ...report.platforms.map((p) => p.platform)]) {
    const title = scope === "total" ? "全部平台合计" : PLATFORM_LABELS[scope as keyof typeof PLATFORM_LABELS] ?? scope;
    lines.push(`\n【${title}】`);
    for (const key of METRIC_KEYS as readonly MetricKey[]) {
      const w = report.growth[`${scope}.${key}`];
      if (!w) continue;
      const current = key === "interactionRate" || key === "shareRate"
        ? w.current === null ? "数据不足" : `${(w.current * 100).toFixed(2)}%`
        : key === "fansPerK"
          ? w.current === null ? "数据不足" : `${w.current.toFixed(2)} 个/千阅读`
          : num(w.current);
      lines.push(`- ${METRIC_LABELS[key]}：本期 ${current}；${growth(w)}`);
    }
  }

  lines.push("\n【账号】");
  for (const a of report.accounts) {
    lines.push(`- ${a.name}（${PLATFORM_LABELS[a.platform as keyof typeof PLATFORM_LABELS] ?? a.platform}）：期初 ${num(a.fans_start)} → 期末 ${num(a.fans_end)}，新增 ${a.fans_new === null ? "数据不足" : num(a.fans_new)}`);
  }

  for (const platform of report.platforms.map((p) => p.platform)) {
    const items = report.contents.filter((c) => c.platform === platform).slice(0, 5);
    if (!items.length) continue;
    lines.push(`\n【${PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform} Top 5 内容】`);
    for (const c of items) lines.push(`- ${c.title.slice(0, 40)}：阅读/曝光 ${num(c.reach)}，分享 ${num(c.shares)}，互动 ${num(c.interaction)}，涨粉 ${num(c.new_followers)}`);
  }

  if (report.channelTypes.length) {
    lines.push("\n【获客渠道构成】");
    for (const t of report.channelTypes) lines.push(`- ${t.type}：${num(t.count)} 条`);
    lines.push(`- 合计：${num(report.leadsTotal)} 条`);
  }

  lines.push("\n【逐月走势（全部平台）】");
  for (const t of report.trend) lines.push(`- ${t.label}：阅读/曝光 ${num(t.total?.reach)}，互动 ${num(t.total?.interaction)}，新增粉丝 ${num(t.total?.fansNew)}，获客 ${num(t.total?.leads)}`);

  return lines.join("\n");
}

/**
 * 输出里的数字必须在输入里找得到（逗号去掉后按子串比）。1–2 位的整数跳过：
 * 「22」可能来自 22.3 的四舍五入，误杀比放过更糟；大数（≥3 位）编不出来，必须锚住。
 */
export function unanchoredNumbers(body: string, corpus: string): string[] {
  const flat = corpus.replace(/,/g, "");
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const match of body.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const digits = match[0].replace(/,/g, "");
    // 纯整数的 1–2 位跳过（「22」可能是 22.3 的四舍五入）；带小数的一律要锚住（「35.6」编不出来）。
    if (!digits.includes(".") && digits.length < 3) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    if (!flat.includes(digits)) bad.push(match[0]);
  }
  return bad;
}

/** 生成并落库（草稿）。失败时把原因写进 error，看板照常显示表格。 */
export async function generateAnalysis(month: string): Promise<void> {
  const report = await loadReport(month);
  if (!report) throw new Error(`没有 ${month} 的数据`);
  const model = await modelFor("board");
  const corpus = digest(report);
  try {
    const res = await chatJson({
      model,
      purpose: "board_analysis",
      subject: `board:${month}`,
      promptVersion: ANALYSIS_VERSION,
      system: SYSTEM,
      user: corpus,
      schema: Schema,
      temperature: 0.2,
      maxTokens: 1200,
    });
    // 归一化：模型可能把 advice 写成一整段（用换行或分号分隔）、把 reading 写成数组，都收成页面要的形状。
    const asList = (v: string | string[] | undefined): string[] =>
      (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+|；/) : [])
        .map((line) => line.replace(/^\s*(?:\d+[.、)）]|[-*•])\s*/, "").trim())
        .filter(Boolean);
    const readingText = Array.isArray(res.data.reading) ? asList(res.data.reading).join("\n\n") : res.data.reading.trim();
    const adviceList = asList(res.data.advice).slice(0, 6);
    const highlights = (res.data.highlights ?? []).slice(0, 5).map((h) => ({
      label: h.label.slice(0, 12),
      value: h.value.slice(0, 18),
      change: (h.change ?? "").slice(0, 18),
      tone: (h.tone === "up" || h.tone === "down" ? h.tone : "flat") as "up" | "down" | "flat",
    }));
    const data: AnalysisData = { highlights, reading: readingText, advice: adviceList };
    // 纯文本版：解读在前、编号后的建议在后，导出/回退都用它。
    const body = [readingText, ...adviceList.map((a, i) => `${i + 1}. ${a}`)].join("\n\n");
    const bad = unanchoredNumbers([readingText, ...adviceList, ...highlights.flatMap((h) => [h.label, h.value, h.change])].join("\n"), corpus);
    if (bad.length) throw new Error(`分析里出现了输入中没有的数字：${bad.slice(0, 5).join("、")}`);
    await sql`
      insert into board_analysis (month, body, data, model, prompt, published, published_at, error, created_at)
      values (${month}, ${body}, ${sql.json(data as never)}::jsonb, ${model}, ${ANALYSIS_VERSION}, false, null, null, now())
      on conflict (month) do update set body = excluded.body, data = excluded.data, model = excluded.model,
        prompt = excluded.prompt, published = false, published_at = null, error = null, created_at = now()`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      insert into board_analysis (month, body, model, prompt, error, created_at)
      values (${month}, '', ${model}, ${ANALYSIS_VERSION}, ${message.slice(0, 500)}, now())
      on conflict (month) do update set body = '', model = excluded.model, prompt = excluded.prompt,
        error = excluded.error, published = false, published_at = null, created_at = now()`;
    throw error;
  }
}

export async function loadAnalysis(month: string): Promise<AnalysisRow | null> {
  const [row] = await sql<AnalysisRow[]>`
    select month, body, data, model, prompt, published, to_char(published_at, 'YYYY-MM-DD HH24:MI') as published_at, error, created_at
    from board_analysis where month = ${month}`;
  return row ?? null;
}

/** 公开出口用它：只有已发布、且正文非空才返回。 */
export async function publicAnalysis(month: string): Promise<PublishedAnalysis | null> {
  const row = await loadAnalysis(month);
  if (!row?.published || !row.body) return null;
  return { body: row.body, data: row.data };
}

/** 发布 / 撤回。发布后才会出现在公开页。 */
export async function setPublished(month: string, published: boolean): Promise<void> {
  await sql`
    update board_analysis set published = ${published},
      published_at = case when ${published} then now() else null end
    where month = ${month}`;
}
