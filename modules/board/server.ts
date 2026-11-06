// 看板的后端插口。两条纪律先写在这儿：
//   1) 上传只做「解析 + 校验 + 落库」，不调模型；月度分析是 worker 的任务（P2），页面打开时也不调模型。
//   2) 后台的写全部经过 adminHandler（会话 + CSRF），并且留审计；公开读只走 /api/site/board 这一个出口。
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { actorOf } from "@aihot/backend/admin/auth";
import { audit } from "@aihot/backend/audit";
import { checkMonth, parseLeads, parseMaster, readBook } from "./backend/parse.ts";
import { commitMonth, deleteMonth, listMonths, listUploads, loadReport, recordUpload } from "./backend/store.ts";
import { generateAnalysis, loadAnalysis, publicAnalysis, setPublished } from "./backend/analyze.ts";
import type { UploadPreview } from "./types.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BYTES = 10 * 1024 * 1024;
/** 只吃这两类扩展名：老 .xls（BIFF8）和 .xlsx。其余一律拒收，不去猜别人给的 MIME。 */
const ALLOWED = /\.(xlsx|xls)$/i;

class BadRequest extends Error {
  statusCode = 400;
}

const labelFor = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

/** 收上来的文件：字段名、原名、字节、sha256。空文件或超大当场拒。 */
async function takeFile(form: FormData, field: string, required: boolean) {
  const item = form.get(field);
  if (!(item instanceof File)) {
    if (required) throw new BadRequest(`缺少「${field}」文件`);
    return null;
  }
  if (!ALLOWED.test(item.name)) throw new BadRequest(`「${item.name}」不是 .xls 或 .xlsx 文件`);
  const data = new Uint8Array(await item.arrayBuffer());
  if (!data.byteLength) throw new BadRequest(`「${item.name}」是空文件`);
  if (data.byteLength > MAX_BYTES) throw new BadRequest(`「${item.name}」超过 10MB`);
  return { name: item.name.slice(0, 200), data, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.byteLength };
}

/** 原始文件按内容哈希留档在上传目录里：解析规则改了可以拿原文件重放，不用麻烦上传人再传一遍。 */
async function archive(file: { name: string; data: Uint8Array; sha256: string }) {
  const dir = path.join(config.dataDir, "uploads", "board");
  const ext = ALLOWED.exec(file.name)?.[1]?.toLowerCase() ?? "xlsx";
  const target = path.join(dir, `${file.sha256.slice(0, 16)}.${ext}`);
  await mkdir(dir, { recursive: true });
  await writeFile(target, file.data);
  return target;
}

async function formOf(req: FastifyRequest): Promise<FormData> {
  if (!Buffer.isBuffer(req.body)) throw new BadRequest("要用 multipart/form-data 提交");
  try {
    return await new Response(req.body as Buffer<ArrayBuffer>, { headers: { "content-type": String(req.headers["content-type"] ?? "") } }).formData();
  } catch {
    throw new BadRequest("表单格式不正确");
  }
}

const queryOf = (req: FastifyRequest) => req.query as Record<string, string | undefined>;
const monthParam = (req: FastifyRequest) => (req.params as { month: string }).month;

/** 月度分析在 worker 里跑：页面请求只入队，读者打开页面永远不触发模型调用（AGENTS.md 的硬规则）。 */
const boardAnalysisQueue = defineQueue<{ month: string }>({
  name: "board.analysis",
  options: { retryLimit: 1, expireInSeconds: 300 },
  worker: { batchSize: 1 },
  run: async (jobs) => {
    for (const job of jobs) await generateAnalysis(job.month);
  },
});

export const boardServerModule = defineServerModule({
  name: "board",
  // 独立的模型步骤：默认沿用 default 预设，可用 BOARD_MODEL 单独指定，不占评分/写作的额度。
  models: { board: { label: "看板月度分析", env: "BOARD_MODEL", purposes: ["board_analysis"] } },
  queues: [boardAnalysisQueue],

  http(app: FastifyInstance) {
    // 上传用的是原生 multipart 解析（和反馈截图同一套路：不引插件、不走 base64）。
    // 已经有了就不重复注册 —— Fastify 对同一 content-type 的第二次注册会直接抛错。
    if (!app.hasContentTypeParser("multipart/form-data")) {
      app.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    }

    // 上传本月报表：总表必填、获客表选填；同月重传是整月替换。
    // 解析不通过时返回 200 + 逐条原因（后台要把整份报告列出来，400 的 detail 会被截到 300 字）。
    app.post("/api/admin/board/uploads", adminHandler(async (req, _reply, admin) => {
      const form = await formOf(req);
      const month = String(form.get("month") ?? "");
      if (!MONTH_RE.test(month)) throw new BadRequest("月份要选对，格式是 2026-09");
      const masterFile = await takeFile(form, "master", true);
      const leadsFile = await takeFile(form, "leads", false);
      const actor = actorOf(admin);
      const batch = `${month}-${Date.now().toString(36)}`;

      const master = parseMaster(readBook(masterFile!.data));
      const leads = leadsFile ? parseLeads(readBook(leadsFile.data)) : null;
      const monthIssue = checkMonth(master.snapshot, month);
      if (monthIssue) master.errors.push(monthIssue);

      const files = [
        { field: "master", filename: masterFile!.name, bytes: masterFile!.bytes, sha256: masterFile!.sha256 },
        ...(leadsFile ? [{ field: "leads", filename: leadsFile.name, bytes: leadsFile.bytes, sha256: leadsFile.sha256 }] : []),
      ];
      const preview: UploadPreview = { month, master, leads, files };

      await Promise.all([archive(masterFile!), ...(leadsFile ? [archive(leadsFile)] : [])]).catch((error) => req.log.warn({ err: error }, "看板原文件留档失败"));

      // 留痕的插入交给 commitMonth 放进同一个事务里，这里只组装参数，不提前落库。
      const record = (kind: string, f: (typeof files)[number], rowsOk: number, rowsSkipped: number, skipped: unknown[], warnings: unknown[], status: string, error: string | null) =>
        ({ batch, month, kind, actor, filename: f.filename, bytes: f.bytes, sha256: f.sha256, rowsOk, rowsSkipped, skipped, warnings, status, error });

      if (master.errors.length) {
        await recordUpload({
          batch, month, kind: "reject", actor, status: "rejected",
          filename: files.map((f) => f.filename).join(" + "), bytes: files.reduce((s, f) => s + f.bytes, 0),
          sha256: files.map((f) => f.sha256).join(","), error: master.errors.map((e) => e.message).join("；").slice(0, 500),
        });
        await audit(actor, "board.upload.rejected", month, master.errors.map((e) => e.message).join("；").slice(0, 300), null, { files });
        return { status: "rejected", preview };
      }

      await commitMonth(
        { month, label: labelFor(month), accounts: master.accounts, contents: master.contents, channels: leads?.channels ?? [] },
        [
          // 「入库」按**内容条数**记，方便和看板上的「发布内容数」对上；账号数写进说明里，不混进行数。
          record("master", files[0]!, master.contents.length, master.skipped.length, master.skipped, [...master.warnings, ...(master.accounts.length ? [{ message: `另有账号 ${master.accounts.length} 个（粉丝快照）` }] : [])], "ok", null),
          ...(leads && files[1] ? [record("leads", files[1]!, leads.channels.length, 0, [], leads.warnings, "ok", null)] : []),
        ],
      );
      await audit(actor, "board.upload", month, `整月替换 ${month}：账号 ${master.accounts.length}、内容 ${master.contents.length}、渠道 ${leads?.channels.length ?? 0}`, null, { files, warnings: [...master.warnings, ...(leads?.warnings ?? [])] });
      return { status: "ok", preview };
    }));

    app.get("/api/admin/board/months", adminHandler(async () => listMonths()));

    app.get("/api/admin/board/report", adminHandler(async (req) => {
      const q = queryOf(req);
      const month = q.month ?? (await listMonths())[0]?.month;
      if (!month || !MONTH_RE.test(month)) throw new BadRequest("month 要形如 2026-09");
      const compare = q.compare && MONTH_RE.test(q.compare) ? q.compare : null;
      // 没有数据就回 null，不抛 400：URL 里可能留着一个刚被删掉的月份，
      // 一个"这个月没数据"不该把整个后台页面打成错误页。
      return { report: await loadReport(month, compare), uploads: await listUploads(month), analysis: await loadAnalysis(month) };
    }));

    // 生成月度分析：只入队，不在请求里调模型。
    app.post("/api/admin/board/analysis", adminHandler(async (req, _reply, admin) => {
      const body = (req.body ?? {}) as { month?: string };
      const month = String(body.month ?? "");
      if (!MONTH_RE.test(month)) throw new BadRequest("month 要形如 2026-09");
      const report = await loadReport(month);
      if (!report) throw new BadRequest(`没有 ${month} 的数据，先上传报表`);
      const queued = await enqueueOn(boardAnalysisQueue, { month });
      await audit(actorOf(admin), "board.analysis.generate", month, "生成月度分析（草稿）", null, null);
      return { queued: queued !== null };
    }));

    // 发布 / 撤回：只有发布过的分析才会出现在公开页。
    app.post("/api/admin/board/analysis/publish", adminHandler(async (req, _reply, admin) => {
      const body = (req.body ?? {}) as { month?: string; published?: boolean };
      const month = String(body.month ?? "");
      if (!MONTH_RE.test(month)) throw new BadRequest("month 要形如 2026-09");
      const row = await loadAnalysis(month);
      if (!row || !row.body) throw new BadRequest("这个月还没有可发布的草稿");
      await setPublished(month, body.published === true);
      await audit(actorOf(admin), body.published === true ? "board.analysis.publish" : "board.analysis.unpublish", month, "", null, null);
      return { ok: true };
    }));

    app.post("/api/admin/board/months/:month/delete", adminHandler(async (req, _reply, admin) => {
      const month = monthParam(req);
      if (!MONTH_RE.test(month)) throw new BadRequest("month 要形如 2026-09");
      const actor = actorOf(admin);
      await deleteMonth(month, actor);
      await audit(actor, "board.month.delete", month, `删除 ${month} 的看板数据`, null, null);
      return { ok: true };
    }));

    // 读者侧：只给已发布的解读。分析默认是草稿，管理员在后台看过再发布。
    app.get("/api/site/board", async (_req, reply: FastifyReply) => reply.header("cache-control", "public, max-age=300, must-revalidate").send(await publicMonths()));

    app.get("/api/site/board/:month", async (req: FastifyRequest, reply: FastifyReply) => {
      const month = monthParam(req);
      if (!MONTH_RE.test(month)) return reply.code(404).send({ error: "not_found" });
      const compare = queryOf(req).compare && MONTH_RE.test(String(queryOf(req).compare)) ? String(queryOf(req).compare) : null;
      const body = await publicReport(month, compare);
      if (!body) return reply.code(404).send({ error: "not_found", detail: "还没有这个月的数据。" });
      return reply.header("cache-control", "public, max-age=300, must-revalidate").send(body);
    });
  },
});

/** 公开的月份清单：后台和读者用的是同一份数，不做两套口径。 */
export async function publicMonths() {
  const months = await listMonths();
  return { months, latest: months[0]?.month ?? null };
}

export async function publicReport(month: string, compare: string | null) {
  const report = await loadReport(month, compare);
  if (!report) return null;
  return { ...report, analysis: await publicAnalysis(month) };
}
