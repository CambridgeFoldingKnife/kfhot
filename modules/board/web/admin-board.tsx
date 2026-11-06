// 后台「数据统计」（/admin/board）：上传各平台月度报表、看解析结果、看同一份看板、删错月。
// 上传只做「解析 + 校验 + 入库」，不调模型；看板主体与公开页共用 board-view.tsx，
// 所以后台看到的每一个数，和读者在 /board 看到的必然相同。
import { useRef, useState } from "react";
import { Link, useLoaderData, useLocation, useRevalidator } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { bj } from "@aihot/web/features/admin/format";
import { toast } from "@aihot/web/features/admin/toast";
import { AdminPage, Badge, Button, Card, DataTable, Field, Input, Select, type Column } from "@aihot/web/features/admin/ui";
import type { AnalysisRow, BoardMonthRow, BoardReport, UploadPreview } from "@aihot/board/types";
import { AnalysisView, BoardView } from "./board-view.tsx";

interface UploadRow {
  id: number;
  batch: string;
  kind: string;
  filename: string;
  bytes: number;
  rows_ok: number;
  rows_skipped: number;
  skipped: Array<{ sheet?: string; row?: number; reason?: string; title?: string }>;
  warnings: Array<{ message?: string; sheet?: string }>;
  status: string;
  error: string | null;
  created_by: string;
  created_at: string;
}

interface LoaderData {
  months: BoardMonthRow[];
  month: string | null;
  report: BoardReport | null;
  uploads: UploadRow[];
  analysis: AnalysisRow | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 默认落在上一个自然月：报表总是次月才导。 */
function lastMonth(): string {
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

export async function loader({ request }: { request: Request }): Promise<LoaderData> {
  const url = new URL(request.url);
  const asked = url.searchParams.get("month");
  const compare = url.searchParams.get("compare");
  const months = await adminGet<BoardMonthRow[]>(request, "/api/admin/board/months");
  // 只认库里真实存在的月份：地址栏可能还留着上个月份（记住页面会把 ?month= 一起记住），
  // 那个月被删掉后再进页面不该报错，退回最新月。
  const month = asked && MONTH_RE.test(asked) && months.some((m) => m.month === asked) ? asked : months[0]?.month ?? null;
  if (!month) return { months, month: null, report: null, uploads: [], analysis: null };
  const data = await adminGet<{ report: BoardReport; uploads: UploadRow[]; analysis: AnalysisRow | null }>(
    request,
    `/api/admin/board/report?month=${month}${compare && MONTH_RE.test(compare) ? `&compare=${compare}` : ""}`,
  );
  return { months, month, report: data.report, uploads: data.uploads, analysis: data.analysis };
}

export const meta = () => [{ title: "数据统计 · 后台" }, { name: "robots", content: "noindex" }];

export default function AdminBoard() {
  const data = useLoaderData() as LoaderData;

  return (
    <AdminPage
      title="数据统计"
      subtitle="每月上传各平台后台导出的报表：总表（含粉丝快照与内容明细）+ 获客表。解析入库后公开页 /board 同步更新；同月重传是整月替换。"
    >
      <div className="grid gap-5">
        {data.months.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-ink-4">切换月份</span>
            {data.months.map((m) => (
              <Link
                key={m.month}
                to={`/admin/board?month=${m.month}`}
                preventScrollReset
                aria-current={m.month === data.month ? "page" : undefined}
                className={`rounded-control px-3 py-1.5 text-[13px] ring-1 transition-colors ${
                  m.month === data.month
                    ? "bg-accent-soft text-accent ring-accent/40"
                    : "bg-surface text-ink-2 ring-line-strong hover:bg-bg-sunk hover:text-ink"
                }`}
              >
                {m.label}
              </Link>
            ))}
          </div>
        )}
        <UploadCard uploaded={data.months.map((m) => m.month)} fallback={data.month ?? undefined} />
        {data.month && data.report ? <AnalysisCard month={data.month} analysis={data.analysis} /> : null}
        {data.report && data.month ? (
          <>
            <CompareBar months={data.months} month={data.month} />
            <BoardView report={data.report} months={data.months.map((m) => ({ month: m.month, label: m.label }))} />
            <UploadHistory rows={data.uploads} month={data.month} />
          </>
        ) : (
          <Card title="还没有数据">
            <p className="text-[13px] leading-relaxed text-ink-2">
              用上面的表单上传一个月的总表就能开始。9 月那批可以直接传：总表 <span className="font-mono text-[12.5px]">总表：公众号+小红书数据汇总.xls</span>、
              获客表 <span className="font-mono text-[12.5px]">9月公众号+小红书获客数据汇总.xlsx</span>。单账号的文件不用传 —— 总表里已经含了每个账号的粉丝快照，
              而单账号导出里没有那段快照，两边都传还会把内容重复计一遍。
            </p>
          </Card>
        )}
      </div>
    </AdminPage>
  );
}

/** AI 月度分析：只入队，worker 跑完再刷新；草稿要点「发布」才会出现在公开页。 */
function AnalysisCard({ month, analysis }: { month: string; analysis: AnalysisRow | null }) {
  const { run, pending } = useAdminAction();
  const revalidator = useRevalidator();
  const [waiting, setWaiting] = useState(false);
  const busy = pending === "board-analysis" || waiting;

  async function generate() {
    const res = await run<{ queued: boolean }>("POST", "/api/admin/board/analysis", { month }, { label: "board-analysis" });
    if (!res?.queued) return;
    setWaiting(true);
    toast("已提交，约 10–30 秒后自动刷新", "ok");
    window.setTimeout(() => {
      revalidator.revalidate();
      setWaiting(false);
    }, 25_000);
  }

  return (
    <Card
      title="AI 月度分析"
      right={
        <div className="flex items-center gap-2">
          {analysis?.body ? (
            <Button
              size="sm"
              tone={analysis.published ? "secondary" : "primary"}
              busy={pending === "board-analysis-publish"}
              onClick={() =>
                run("POST", "/api/admin/board/analysis/publish", { month, published: !analysis.published }, {
                  label: "board-analysis-publish",
                  success: analysis.published ? "已撤回，公开页不再显示" : "已发布，公开页 5 分钟内更新",
                })
              }
            >
              {analysis.published ? "撤回" : "发布到公开页"}
            </Button>
          ) : null}
          <Button size="sm" busy={busy} onClick={generate}>
            {analysis?.body ? "重新生成" : "生成分析"}
          </Button>
        </div>
      }
    >
      {analysis?.error ? (
        <p className="rounded-control bg-hot-soft/60 px-3 py-2 text-[12.5px] text-hot">生成失败：{analysis.error}</p>
      ) : null}
      {analysis?.body ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-4">
            <Badge tone={analysis.published ? "ok" : "warn"}>{analysis.published ? `已发布 ${analysis.published_at ?? ""}` : "草稿（未发布）"}</Badge>
            <span>模型 {analysis.model ?? "—"} · 生成于 {bj(analysis.created_at, true)}</span>
          </div>
          <AnalysisView analysis={{ body: analysis.body, data: analysis.data }} />
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">
            这段由模型基于上面这张表写成，数字都来自表格、不含自己算的增长率。**发布后**会出现在公开页 `/board`；觉得不合适就重新生成，或撤回。
          </p>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink-3">
          {waiting ? "正在生成（worker 里跑，页面不用等）……" : "点「生成分析」：模型会读本月与往月的指标，写一段数据解读和行动建议，先存成草稿，你确认后再发布。"}
        </p>
      )}
    </Card>
  );
}

/** 对比月：不选就按上一自然月比。列出的都是这个月之前的月份。 */
function CompareBar({ months, month }: { months: BoardMonthRow[]; month: string }) {
  const current = new URLSearchParams(useLocation().search).get("compare") ?? "";
  const idx = months.findIndex((m) => m.month === month);
  const options = months.slice(idx + 1, idx + 5);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-ink-4" title="KPI 卡和对比表的第一列都跟它走">对比基准</span>
      {[
        { value: "", label: "上一自然月", to: `/admin/board?month=${month}` },
        ...options.map((m) => ({ value: m.month, label: m.label, to: `/admin/board?month=${month}&compare=${m.month}` })),
      ].map((option) => (
        <Link
          key={option.label}
          to={option.to}
          preventScrollReset
          aria-current={current === option.value ? "page" : undefined}
          className={`rounded-control px-3 py-1.5 text-[13px] ring-1 transition-colors ${
            current === option.value
              ? "bg-accent-soft text-accent ring-accent/40"
              : "bg-surface text-ink-2 ring-line-strong hover:bg-bg-sunk hover:text-ink"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

function UploadCard({ uploaded, fallback }: { uploaded: string[]; fallback?: string }) {
  const { run, pending } = useAdminAction();
  const master = useRef<HTMLInputElement>(null);
  const leads = useRef<HTMLInputElement>(null);
  const initial = fallback ?? lastMonth();
  const [year, setYear] = useState(initial.slice(0, 4));
  const [mon, setMon] = useState(initial.slice(5, 7));
  const month = `${year}-${mon}`;
  // 年份给全量范围（2000–2099）：报表要补历史、也可能往前设，别把年份限制死。
  const years = Array.from({ length: 100 }, (_, i) => String(2000 + i));
  const [result, setResult] = useState<UploadPreview | null>(null);
  const [ok, setOk] = useState(false);

  const picked = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.files?.[0] ?? null;

  async function submit() {
    if (!MONTH_RE.test(month)) return toast("月份要形如 2026-09", "error");
    const m = picked(master);
    if (!m) return toast("要先选总表（.xls 或 .xlsx）", "error");
    const fd = new FormData();
    fd.set("month", month);
    fd.set("master", m);
    const l = picked(leads);
    if (l) fd.set("leads", l);
    setResult(null);
    const res = await run<{ status: string; preview: UploadPreview }>("POST", "/api/admin/board/uploads", fd, { label: "board-upload" });
    if (!res) return;
    setResult(res.preview);
    setOk(res.status === "ok");
    if (res.status === "ok") {
      toast(`已入库：账号 ${res.preview.master.accounts.length}、内容 ${res.preview.master.contents.length}、渠道 ${res.preview.leads?.channels.length ?? 0}`, "ok");
      if (master.current) master.current.value = "";
      if (leads.current) leads.current.value = "";
    } else {
      toast("解析未通过，没有写入任何数据", "error");
    }
  }

  const files = (
    <Field
      label="总表（必填）"
      hint="一个工作簿，每个账号一个 sheet，sheet 名叫「公众号-账号」「小红书-账号」，里面同时含粉丝快照区和内容明细区。"
    >
      <input ref={master} type="file" accept=".xls,.xlsx" className="block w-full text-[13px] file:mr-3 file:rounded-control file:border-0 file:bg-bg-sunk file:px-3 file:py-1.5 file:text-[12.5px]" />
    </Field>
  );

  return (
    <Card title="上传本月报表">
      <div className="grid gap-4">
        <Field label="这个月的数据" hint="总表里没有月份，靠这里选；入库前会用表内粉丝快照的日期反查，选错会被拦下。">
          <div className="grid w-full grid-cols-2 gap-2 sm:max-w-sm">
            <Select value={year} onChange={(e) => setYear(e.target.value)} aria-label="年份" className="w-full">
              {years.map((y) => <option key={y} value={String(y)}>{y} 年</option>)}
            </Select>
            <Select value={mon} onChange={(e) => setMon(e.target.value)} aria-label="月份" className="w-full">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                <option key={m} value={m}>{Number(m)} 月</option>
              ))}
            </Select>
          </div>
        </Field>
        <div className="grid gap-3">
          {files}
          <Field label="获客表（选填）" hint="渠道明细表。没传就只入库账号与内容，获客那一块显示「未上传」。">
            <input ref={leads} type="file" accept=".xls,.xlsx" className="block w-full text-[13px] file:mr-3 file:rounded-control file:border-0 file:bg-bg-sunk file:px-3 file:py-1.5 file:text-[12.5px]" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button tone="primary" busy={pending === "board-upload"} onClick={submit}>解析并入库</Button>
            {uploaded.length ? <span className="text-[12px] text-ink-4">已有月份：{uploaded.join("、")}（同月重传 = 整月替换）</span> : null}
          </div>
        </div>
      </div>

      {result && (
        <div className="mt-4 rounded-control bg-bg-sunk px-3 py-2.5 text-[12.5px] leading-relaxed">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ok ? "ok" : "bad"}>{ok ? "已入库" : "未入库"}</Badge>
            <span className="text-ink-2">
              账号 {result.master.accounts.length} 个 · 内容 {result.master.contents.length} 条 ·
              渠道 {result.leads ? `${result.leads.channels.length} 条（合计 ${result.leads.total}）` : "未传获客表"}
              {result.master.skipped.length ? ` · 跳过 ${result.master.skipped.length} 行` : ""}
            </span>
          </div>
          {[...result.master.errors, ...(result.leads?.errors ?? [])].map((e, i) => (
            <p key={`e${i}`} className="mt-1 text-hot">✗ {e.sheet ? `〔${e.sheet}〕` : ""}{e.message}</p>
          ))}
          {[...result.master.warnings, ...(result.leads?.warnings ?? [])].map((w, i) => (
            <p key={`w${i}`} className="mt-1 text-ink-3">⚠ {w.sheet ? `〔${w.sheet}〕` : ""}{w.message}</p>
          ))}
          {result.master.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-ink-3">
              {result.master.skipped.slice(0, 8).map((s, i) => (
                <li key={`s${i}`}>〔{s.sheet}〕第 {s.row} 行「{s.title}」：{s.reason}</li>
              ))}
              {result.master.skipped.length > 8 ? <li>……共 {result.master.skipped.length} 行</li> : null}
            </ul>
          )}
          <p className="mt-1 text-ink-4">识别到的 sheet：{result.master.sheets.join("、")}</p>
          <p className="mt-1 text-ink-4">原文件已按内容哈希留在服务器的上传目录里，解析规则改了可以拿原文件重放，不用再传一次。</p>
        </div>
      )}
    </Card>
  );
}

const KIND_LABELS: Record<string, string> = { master: "总表", leads: "获客表", reject: "被拒的上传", delete: "删除" };

function UploadHistory({ rows, month }: { rows: UploadRow[]; month: string }) {
  const { run, pending } = useAdminAction();
  const columns: Column<UploadRow>[] = [
    // 库里是 timestamptz，接口回 ISO；这里转成北京时间，不依赖浏览器所在时区。
    { key: "created_at", label: "时间", render: (r) => <span className="num whitespace-nowrap text-[12.5px]">{bj(r.created_at, true)}</span> },
    { key: "kind", label: "内容", render: (r) => KIND_LABELS[r.kind] ?? r.kind },
    { key: "filename", label: "文件", render: (r) => <span className="block max-w-[220px] truncate" title={r.filename}>{r.filename || "—"}</span> },
    { key: "rows_ok", label: "入库", align: "right", render: (r) => <span className="tabular-nums">{r.rows_ok}</span> },
    {
      key: "rows_skipped",
      label: "跳过",
      align: "right",
      render: (r) => (
        <span
          className={`tabular-nums ${r.rows_skipped ? "cursor-help underline decoration-dotted" : ""}`}
          title={r.rows_skipped ? (r.skipped ?? []).map((s) => `〔${s.sheet ?? ""}〕第 ${s.row ?? "?"} 行：${s.reason ?? ""}`).join("\n") : undefined}
        >
          {r.rows_skipped}
        </span>
      ),
    },
    {
      key: "warnings",
      label: "警告",
      render: (r) =>
        r.warnings.length ? <span title={r.warnings.map((w) => `${w.sheet ? `〔${w.sheet}〕` : ""}${w.message ?? ""}`).join("\n")}>{r.warnings.length} 条</span> : <span className="text-ink-4">—</span>,
    },
    {
      key: "status",
      label: "结果",
      render: (r) => <Badge tone={r.status === "ok" ? "ok" : r.status === "deleted" ? "muted" : "bad"} title={r.error ?? undefined}>{r.status === "ok" ? "入库" : r.status === "deleted" ? "已删除" : "拒绝"}</Badge>,
    },
    { key: "created_by", label: "操作人", render: (r) => <span className="font-mono text-[12px]">{r.created_by}</span> },
  ];
  return (
    <Card
      title="上传留痕"
      right={
        <Button
          size="sm"
          tone="danger"
          busy={pending === "board-delete"}
          onClick={async () => {
            if (!window.confirm(`删除 ${month} 的全部看板数据？账号、内容、获客三类都会被清掉；上传留痕与原文件保留。`)) return;
            await run("POST", `/api/admin/board/months/${month}/delete`, undefined, { label: "board-delete", success: `${month} 已删除` });
          }}
        >
          删除本月
        </Button>
      }
    >
      <DataTable<UploadRow> dense rows={rows} rowKey={(r) => r.id} empty="还没有上传记录。" columns={columns} />
    </Card>
  );
}
