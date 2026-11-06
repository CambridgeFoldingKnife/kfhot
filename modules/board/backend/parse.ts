// 把各平台后台导出的月度 Excel 解析成看板的行。
//
// 逻辑从 kfhot/scripts/import_board.py 平移（那份产物 2026-10 逐字节核对过原始 Excel），
// 只改了三处「静默丢数据」：不符合「平台-账号」的 sheet、获客表除第一个以外的 sheet、
// 列数不够的行 —— 过去直接跳过不吭声，现在都要么报错要么留痕（见方案 §3.4）。
//
// 两处不能"顺手改"的读法，改了就对不上旧产物：
//   1) 数字取单元格的原始值，不取格式化文本 —— 小红书的点击率原始值是 0.017，格式化文本是 "1.7%"。
//   2) 粉丝快照区只认「数值序列号」，不认文本日期 —— 那是判定"这一行还属于快照区"的边界条件，
//      换成宽松的日期识别会把表尾的说明文字也当成快照。
import * as XLSX from "xlsx";
import { PLATFORM_PREFIXES, type AccountRow, type ContentRow, type LeadRow, type MasterParse, type ParseIssue, type SkippedRow, type PlatformKey, type LeadsParse } from "../types.ts";

interface Cell {
  t?: string;
  v?: unknown;
  w?: string;
  z?: string;
}

export interface Sheet {
  name: string;
  rows: (Cell | null)[][];
}

export interface Book {
  sheets: Sheet[];
  /** 日历基准：1904 制（老 Mac Excel）与 1900 制的序列号差 1462 天。 */
  date1904: boolean;
}

const DAY = 86400000;

export function readBook(data: Uint8Array): Book {
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true });
  const sheets: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) {
      sheets.push({ name, rows: [] });
      continue;
    }
    const { s, e } = XLSX.utils.decode_range(ref);
    const rows: (Cell | null)[][] = [];
    for (let r = s.r; r <= e.r; r++) {
      const row: (Cell | null)[] = [];
      for (let c = s.c; c <= e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;
        row.push(cell ? { t: cell.t, v: cell.v, w: cell.w, z: cell.z } : null);
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  const props = wb as unknown as { props?: { date1904?: boolean }; Workbook?: { WBProps?: { date1904?: boolean } } };
  return { sheets, date1904: props.props?.date1904 === true || props.Workbook?.WBProps?.date1904 === true };
}

const cellText = (c: Cell | null): string => {
  if (!c || c.v === undefined || c.v === null) return "";
  if (typeof c.v === "number") return Number.isInteger(c.v) ? String(Math.trunc(c.v)) : String(c.v);
  return String(c.v).trim();
};

/** 原始数值；数字存着但格式化过的单元格取 v（不是 w）。 */
const cellNum = (c: Cell | null): number | null => {
  if (!c) return null;
  if (typeof c.v === "number") return Number.isFinite(c.v) ? c.v : null;
  const s = String(c.w ?? c.v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Excel 序列号 → 'YYYY-MM-DD'。1900 制里那个不存在的 1900-02-29 由 25569 这个基准吸收。 */
export const serialToIso = (n: number, date1904: boolean): string | null => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const epoch = (date1904 ? 24107 : 25569) * DAY;
  const ms = n * DAY - epoch;
  if (ms < -400 * DAY || ms > 100 * 365 * DAY) return null;
  return iso(ms);
};

const ZH_DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
const NUM8 = /^(19|20)\d{6}$/;
const ISO_LIKE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;

const pad = (y: string, m: string, d: string) => `${y}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;

/** 以日期开头的文本（「2026年9月30日…」「2026-09-30 10:00」）：这是日期单元格，不是正文里提到日期。 */
const ZH_DATE_AT_START = /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
const ISO_AT_START = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;

/**
 * 内容行的发表日期。`strict` 只认「本身就是日期」的单元格：8 位数字、日期格式的数字、
 * 或以年月日开头的文本。非 strict 才接受「包含日期」的文本 —— 最后才用。
 *
 * 为什么需要这一层：标题里常常带日期（「【国际认证 · 2026年12月29日-2027年1…」），
 * 若按"第一个包含日期的单元格"找日期列，会把标题当日期、把真正的发表日期当阅读人数。
 */
function dateAt(c: Cell | null, date1904: boolean, strict: boolean): string | null {
  if (!c) return null;
  const s = cellText(c).replace(/\.0$/, "");
  const zh = (strict ? ZH_DATE_AT_START : ZH_DATE).exec(s);
  if (zh) return pad(zh[1], zh[2], zh[3]);
  if (NUM8.test(s)) return pad(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
  const isoLike = (strict ? ISO_AT_START : ISO_LIKE).exec(s);
  if (isoLike && typeof c.v === "string") return pad(isoLike[1], isoLike[2], isoLike[3]);
  // 真正的日期单元格：数字 + 日期格式。旧脚本不认这种，多出来的这一支只可能"多认"，不会改变已认出的行。
  if (typeof c.v === "number" && /yy|m{1,2}|d{1,2}/i.test(c.z ?? "")) return serialToIso(c.v, date1904);
  return null;
}

const parseDate = (c: Cell | null, date1904: boolean) => dateAt(c, date1904, false);

/** 快照区的一行时间：只认落在 1982–2064 的原始序列号（跟旧脚本同一个边界判据）。 */
const snapshotDate = (c: Cell | null, date1904: boolean) => {
  const n = typeof c?.v === "number" ? c.v : null;
  if (n === null || !(30000 < n && n < 60000)) return null;
  return serialToIso(n, date1904);
};

interface Snapshot {
  start_date: string | null;
  end_date: string | null;
  fans_start: number | null;
  fans_end: number | null;
  fans_new: number | null;
}

/** 粉丝快照区：找到含「时间」的那一行，往下逐行读 时间/粉丝数/新增。 */
function parseFans(rows: (Cell | null)[][], date1904: boolean): Snapshot | null {
  const hdr = rows.findIndex((row) => row.some((c) => cellText(c).includes("时间")));
  if (hdr < 0) return null;
  const snaps: Array<{ date: string; fans: number | null; added: number | null }> = [];
  for (const row of rows.slice(hdr + 1)) {
    const t = snapshotDate(row[0] ?? null, date1904);
    if (!t) break;
    snaps.push({ date: t, fans: cellNum(row[2] ?? null), added: cellNum(row[3] ?? null) });
  }
  if (!snaps.length) return null;
  const first = snaps[0]!, last = snaps[snaps.length - 1]!;
  const fansNew = first.added ?? (first.fans !== null && last.fans !== null ? last.fans - first.fans : null);
  return { start_date: first.date, end_date: last.date, fans_start: first.fans, fans_end: last.fans, fans_new: fansNew };
}

/** 每平台的明细列序：位置对不上就不入库并说明差几列，不做"猜列"的模糊匹配。 */
const SHAPE = {
  wechat: { min: 4, columns: ["阅读", "分享", "阅读后关注", "送达"] },
  xhs: { min: 8, columns: ["曝光", "观看", "点击率", "赞", "评论", "收藏", "涨粉", "分享"] },
} as const;

function parseContents(sheet: string, rows: (Cell | null)[][], platform: PlatformKey, date1904: boolean) {
  const items: ContentRow[] = [];
  const skipped: SkippedRow[] = [];
  const hdr = rows.findIndex((row) => {
    const joined = row.map(cellText).join("");
    return joined.includes("发表日期") || joined.includes("首次发布时间");
  });
  if (hdr < 0) return { items, skipped, headerMissing: true };
  rows.slice(hdr + 1).forEach((row, i) => {
    const at = hdr + 2 + i;
    const strs = row.map(cellText);
    // 「本月无」是占位标记行，不是被丢掉的内容，与旧产物口径一致，不计入 skipped。
    if (strs.some((s) => s.includes("本月无"))) return;
    // 先找"本身就是日期"的那一格；整行都没有时才退回"包含日期"的宽松规则。
    const strict = row.findIndex((c) => dateAt(c, date1904, true) !== null);
    const di = strict >= 0 ? strict : row.findIndex((c) => parseDate(c, date1904) !== null);
    if (di < 0) {
      skipped.push({ sheet, row: at, reason: "这一行找不到发表日期", title: strs.filter(Boolean).join(" ").slice(0, 40) });
      return;
    }
    const title = strs.slice(0, di).filter(Boolean).join(" ").replace(/\n/g, " ").trim() || "（无标题）";
    const date = parseDate(row[di] ?? null, date1904);
    const tail = strs.slice(di + 1);
    const url = tail.find((s) => s.startsWith("http")) ?? "";
    const nums = row
      .slice(di + 1)
      .map((c) => cellNum(c))
      .filter((n): n is number => n !== null && n < 1e18);
    const shape = SHAPE[platform];
    if (nums.length < shape.min) {
      skipped.push({ sheet, row: at, title, reason: `只解析到 ${nums.length} 个数字，${platform} 需要 ${shape.min} 列（${shape.columns.join("/")}）` });
      return;
    }
    if (platform === "wechat") {
      items.push({ platform, account: "", title, date, genre: "文章", reach: nums[0]!, shares: nums[1]!, new_followers: nums[2]!, delivered: nums[3]!, url });
      return;
    }
    const genre = tail.find((s) => s === "图文" || s === "视频") ?? "图文";
    items.push({
      platform, account: "", title, date, genre,
      reach: nums[0]!, views: nums[1]!, ctr: nums[2]!, likes: nums[3]!,
      comments: nums[4]!, collects: nums[5]!, new_followers: nums[6]!, shares: nums[7]!, url,
    });
  });
  return { items, skipped, headerMissing: false };
}

/** 总表：sheet 名就是「平台-账号」，每个 sheet 同时含粉丝快照区和内容明细区。 */
export function parseMaster(book: Book): MasterParse {
  const accounts: AccountRow[] = [];
  const contents: ContentRow[] = [];
  const skipped: SkippedRow[] = [];
  const unknownSheets: string[] = [];
  const sheets: string[] = [];
  const errors: ParseIssue[] = [];
  const warnings: ParseIssue[] = [];
  const endDates: string[] = [];

  for (const sheet of book.sheets) {
    if (sheet.name.trim() === "" || !sheet.rows.length) continue;
    sheets.push(sheet.name);
    const prefix = Object.keys(PLATFORM_PREFIXES).find((p) => sheet.name.startsWith(`${p}-`));
    if (!prefix) {
      unknownSheets.push(sheet.name);
      continue;
    }
    const platform = PLATFORM_PREFIXES[prefix]!;
    const account = sheet.name.slice(prefix.length + 1);
    const fans = parseFans(sheet.rows, book.date1904);
    if (fans) endDates.push(fans.end_date!);
    const parsed = parseContents(sheet.name, sheet.rows, platform, book.date1904);
    skipped.push(...parsed.skipped);
    if (!fans && parsed.items.length === 0) {
      warnings.push({ sheet: sheet.name, message: parsed.headerMissing ? "既没有粉丝快照区，也没有含「发表日期/首次发布时间」的明细表头" : "既没有粉丝快照区，也没有解析出任何内容" });
    }
    accounts.push({
      platform,
      name: account,
      start_date: fans?.start_date ?? null,
      end_date: fans?.end_date ?? null,
      fans_start: fans?.fans_start ?? null,
      fans_end: fans?.fans_end ?? null,
      fans_new: fans?.fans_new ?? null,
    });
    for (const c of parsed.items) contents.push({ ...c, account });
  }

  if (unknownSheets.length) {
    warnings.push({ message: `这些 sheet 的名字不符合「平台-账号」，没有入库：${unknownSheets.join("、")}` });
  }
  if (!accounts.length) errors.push({ message: `总表里一个可识别的平台 sheet 都没有（要形如「公众号-健衡学园」「小红书-Theratools」；实际有：${sheets.join("、") || "空表"}）` });

  const sorted = endDates.filter(Boolean).sort();
  return {
    accounts, contents, sheets, unknownSheets, skipped, errors, warnings,
    snapshot: sorted.length ? { min: sorted[0]!, max: sorted[sorted.length - 1]! } : null,
  };
}

/** 渠道归类：六条关键字规则，一条都不命中就是「其他」。照旧产物平移。 */
export function classifyChannel(name: string): string {
  if (name.includes("活码") || name.includes("二维码")) return "活码引流";
  if (name.includes("资料")) return "资料包引流";
  if (name.endsWith("渠道") && name.length <= 5) return "人员渠道";
  if (name.includes("渠道")) return "外部渠道";
  if (name.includes("招募") || name.includes("活动")) return "活动运营";
  if (name.includes("+") || name.includes("小助理")) return "平台内容";
  return "其他";
}

const TOTAL_ROW = /^(合计|总计|小计)$/;

/** 获客表：A 列是「公众号/小红书」分组名，B 列渠道名，C 列数量。旧脚本只读第一个 sheet，这里读全部。 */
export function parseLeads(book: Book): LeadsParse {
  const channels: LeadRow[] = [];
  const errors: ParseIssue[] = [];
  const warnings: ParseIssue[] = [];
  let declared: number | null = null;
  let platform: PlatformKey | null = null;
  let seen = 0;

  for (const sheet of book.sheets) {
    seen++;
    for (const row of sheet.rows) {
      const a = cellText(row[0] ?? null);
      const b = cellText(row[1] ?? null);
      const n = cellNum(row[2] ?? null);
      if (a && a.includes("公众号")) platform = "wechat";
      else if (a && a.includes("小红书")) platform = "xhs";
      if (b && TOTAL_ROW.test(b)) {
        if (n !== null) declared = n;
        continue;
      }
      if (b && n !== null) channels.push({ platform, name: b, count: Math.trunc(n), type: classifyChannel(b) });
    }
  }
  if (!channels.length) errors.push({ message: `获客表里一个渠道都没解析出来（读了 ${seen} 个 sheet；要求 B 列是渠道名、C 列是数字）` });
  const total = channels.reduce((s, c) => s + c.count, 0);
  if (declared !== null && declared !== total) {
    warnings.push({ message: `表里写的合计是 ${declared}，逐条加起来是 ${total}，差 ${total - declared}；看板按逐条相加的 ${total} 显示` });
  }
  const orphan = channels.filter((c) => c.platform === null).length;
  if (orphan) warnings.push({ message: `${orphan} 条渠道上面没有「公众号/小红书」分组名，平台留空` });
  return { channels, total, errors, warnings };
}

/**
 * 管理员选的月份 vs 表里快照日期：快照的**最后一天**要落在所选月份里。
 * 允许落在下个月 1–3 号：月初取数时，快照的期末自然就是上月末之后的那个取数日。
 * 只判断"落在区间内"是不够的——两行快照的区间横跨两个月，选两个月中的任意一个都会通过，
 * 忘了改日期就会把上个月的数据挂到本月。
 */
export function checkMonth(snapshot: MasterParse["snapshot"], month: string): ParseIssue | null {
  if (!snapshot) return null;
  const end = snapshot.max.slice(0, 7);
  if (end === month) return null;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = `${String(m === 12 ? y + 1 : y).padStart(4, "0")}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  if (end === next && Number(snapshot.max.slice(8, 10)) <= 3) return null;
  const range = snapshot.min === snapshot.max ? snapshot.max : `${snapshot.min} 至 ${snapshot.max}`;
  return {
    message: `你选的月份是 ${month}，但表里粉丝快照的最后一天是 ${snapshot.max}（区间 ${range}）。如果传的是 ${snapshot.max.slice(0, 7)} 的表，把上面的月份改成 ${snapshot.max.slice(0, 7)} 再传；如果表确实属于 ${month}，就去改表里的日期。`,
  };
}
