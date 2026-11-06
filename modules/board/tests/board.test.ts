// 数据看板：口径（互动量 / 环比 / 缺数据不是 0）、整月替换、月份反查、解析器的显式报错。
// 样本表用代码生成，不依赖任何外部 Excel 文件。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as XLSX from "xlsx";
import { closeDb } from "@aihot/backend/db";
import { checkMonth, classifyChannel, parseMaster, readBook } from "../backend/parse.ts";
import { cagrOf, growthOf, loadReport, prevMonth, replaceMonth, rowInteraction } from "../backend/store.ts";
import type { AccountRow, ContentRow, LeadRow } from "../types.ts";

after(closeDb);

const A = "2099-11";
const B = "2099-12";

const account = (platform: string, name: string, fansNew: number | null, fansEnd: number | null): AccountRow => ({
  platform: platform as AccountRow["platform"],
  name,
  start_date: "2099-10-31",
  end_date: "2099-11-30",
  fans_start: 1000,
  fans_end: fansEnd,
  fans_new: fansNew,
});

const content = (platform: string, accountName: string, title: string, reach: number | null, shares: number | null, extra: Partial<ContentRow> = {}): ContentRow => ({
  platform: platform as ContentRow["platform"],
  account: accountName,
  title,
  date: "2099-11-10",
  genre: platform === "wechat" ? "文章" : "图文",
  reach,
  shares,
  new_followers: 1,
  delivered: platform === "wechat" ? 5000 : null,
  url: "",
  ...extra,
});

test("互动量按平台各自的口径，且没有一列时是 null 不是 0", () => {
  assert.equal(rowInteraction(content("wechat", "甲", "一", 100, 7)), 7);
  assert.equal(rowInteraction(content("xhs", "乙", "二", 100, 1, { likes: 2, comments: 3, collects: 4 })), 10);
  assert.equal(rowInteraction(content("xhs", "乙", "三", 100, null, { likes: null, comments: null, collects: null })), null);
});

test("绝对量出百分比、比率出百分点；基数 0 或缺一侧就是 null", () => {
  assert.deepEqual(growthOf("abs", 125, 100), { kind: "abs", diff: 25, pct: 25 });
  assert.equal(growthOf("abs", 125, 0), null, "基数为 0 不说成 +∞%");
  assert.equal(growthOf("abs", 125, null), null, "对比月缺数据就是「数据不足」");
  assert.equal(growthOf("abs", null, 100), null);
  assert.deepEqual(growthOf("ratio", 0.024, 0.012), { kind: "ratio", diff: 1.2, pct: null }, "翻倍不说 +100%，说 +1.2pp");
});

test("复合月均要至少两个月的跨度", () => {
  assert.equal(cagrOf(100, 200, 1), null);
  assert.equal(cagrOf(0, 200, 3), null, "起点是 0 不外推");
  assert.equal(cagrOf(100, 100, 3), 0);
  assert.equal(cagrOf(100, 400, 3), 100, "两个间隔翻两番 → 月均 +100%");
});

test("prevMonth 跨年", () => {
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(prevMonth("2026-01", 2), "2025-11");
  assert.equal(prevMonth("2026-12", 12), "2025-12");
});

test("月份反查：快照的最后一天必须落在所选月份（月初 1–3 号取数除外）", () => {
  const onlySeptember = { min: "2026-09-30", max: "2026-09-30" };
  assert.equal(checkMonth(onlySeptember, "2026-09"), null);
  assert.match(String(checkMonth(onlySeptember, "2026-10")?.message), /最后一天是 2026-09-30/);

  // 两行快照横跨两个月时，只判断"落在区间内"会让两个月都通过 —— 这正是要拦的那种"忘了改日期"。
  const spanTwoMonths = { min: "2026-09-30", max: "2026-10-31" };
  assert.equal(checkMonth(spanTwoMonths, "2026-10"), null);
  assert.ok(checkMonth(spanTwoMonths, "2026-09"), "快照期末在 10 月，却选了 9 月 → 拦下");

  // 月初 1–3 号取数时，快照期末自然落在下个月初，这是正常的。
  assert.equal(checkMonth({ min: "2026-09-30", max: "2026-11-02" }, "2026-10"), null);
  assert.ok(checkMonth({ min: "2026-09-30", max: "2026-11-05" }, "2026-10"), "落在下月 5 号就不算月初取数了");

  assert.equal(checkMonth(null, "2026-09"), null, "整表没有快照区时不拦（可能是纯内容表）");
});

test("渠道归类的六条关键字规则", () => {
  assert.equal(classifyChannel("咨询活码"), "活码引流");
  assert.equal(classifyChannel("康复资料包"), "资料包引流");
  assert.equal(classifyChannel("张老师渠道"), "人员渠道");
  assert.equal(classifyChannel("某合作机构渠道"), "外部渠道");
  assert.equal(classifyChannel("赛事服务导师招募"), "活动运营");
  assert.equal(classifyChannel("公众号+小助理"), "平台内容");
  assert.equal(classifyChannel("其他来路"), "其他");
});

/** 生成一份总表：两个合规 sheet + 一个名字不合的 + 一行数字不够的。 */
function sampleWorkbook() {
  const wb = XLSX.utils.book_new();
  const wechat = [
    ["项目", "涨粉", "粉丝", "新增"],
    ["时间", "", "", ""],
    [44000, "", 1000, 50],
    ["内容明细"],
    ["标题", "发表日期", "阅读", "分享", "阅读后关注", "送达"],
    ["正常的一篇", "2026年9月10日", 300, 30, 2, 5000],
    ["数字不够的一篇", "2026年9月11日", 100],
  ];
  const xhs = [
    ["项目", "涨粉", "粉丝", "新增"],
    ["时间", "", "", ""],
    [44001, "", 2000, null],
    ["内容明细"],
    ["标题", "首次发布时间", "体裁", "曝光", "观看", "点击率", "赞", "评", "藏", "涨粉", "分享"],
    ["一条笔记", "2026年9月12日", "视频", 800, 120, 0.15, 5, 1, 2, 1, 3],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wechat), "公众号-甲号");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(xhs), "小红书-乙号");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["随便写的"], ["说明：本月无"]]), "汇总说明");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

test("解析器：不合名的 sheet 与数字不够的行都要说出来，不静默丢", () => {
  const parsed = parseMaster(readBook(sampleWorkbook()));
  assert.deepEqual(parsed.unknownSheets, ["汇总说明"], "名字不符合「平台-账号」的 sheet 要列出来");
  assert.match(parsed.warnings.map((w) => w.message).join(""), /没有入库/, "并且给一句能看懂的警告");
  assert.equal(parsed.errors.length, 0, "有可用 sheet 时不整批拒绝");
  assert.equal(parsed.accounts.length, 2);
  assert.equal(parsed.contents.length, 2, "数字不够的那一行不进内容，另两行进");
  assert.equal(parsed.skipped.length, 1);
  assert.match(parsed.skipped[0]!.reason, /只解析到 1 个数字/);
  assert.equal(parsed.skipped[0]!.title, "数字不够的一篇");
  assert.deepEqual(
    { reach: parsed.contents[1]!.reach, views: parsed.contents[1]!.views, ctr: parsed.contents[1]!.ctr, likes: parsed.contents[1]!.likes, genre: parsed.contents[1]!.genre },
    { reach: 800, views: 120, ctr: 0.15, likes: 5, genre: "视频" },
    "小红书的列序按 曝光/观看/点击率/赞 取",
  );
});

test("总表里一个可识别 sheet 都没有 → 整批拒绝", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["只有说明"]]), "汇总");
  const parsed = parseMaster(readBook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)));
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0]!.message, /一个可识别的平台 sheet 都没有/);
});

const leads: LeadRow[] = [{ platform: "wechat", name: "赛事服务导师招募", count: 6, type: "活动运营" }];

test("整月替换：同月重传不残留，缺传的平台不参与环比也不被当成 0", async () => {
  await replaceMonth({
    month: A,
    label: "2099年11月",
    accounts: [account("wechat", "甲号", 50, 1050), account("xhs", "乙号", null, 2000)],
    contents: [content("wechat", "甲号", "第一篇", 300, 30), content("xhs", "乙号", "一条笔记", 800, 3, { likes: 5, comments: 1, collects: 2 })],
    channels: leads,
  });

  const onlyOne = await loadReport(A);
  assert.ok(onlyOne, "读得回来");
  assert.equal(onlyOne!.growth["wechat.reach"]!.g1, null, "只有一个月的时候，环比是「数据不足」而不是 -100%");
  assert.equal(onlyOne!.total.reach, 1100);
  assert.equal(onlyOne!.total.interaction, 41, "公众号 30 + 小红书(5+1+2+3)");
  assert.equal(onlyOne!.growth["xhs.fansNew"]!.current, null, "没有粉丝快照的账号不计入，也不当 0");
  assert.equal(onlyOne!.leadsTotal, 6);

  // 同月重传：换成只有公众号，且甲号不再出现 —— 乙号那条笔记必须彻底消失，不能留下半批旧数据。
  await replaceMonth({ month: A, label: "2099年11月", accounts: [account("wechat", "甲号", 80, 1080)], contents: [content("wechat", "甲号", "只有公众号的一月", 400, 40)], channels: [] });
  const replaced = await loadReport(A);
  assert.equal(replaced!.platforms.length, 1);
  assert.equal(replaced!.contents.length, 1);
  assert.equal(replaced!.contents[0]!.title, "只有公众号的一月");
  assert.equal(replaced!.total.interaction, 40);
  assert.equal(replaced!.leadsTotal, null, "获客表没传是「未上传」，不是 0");

  await replaceMonth({
    month: B,
    label: "2099年12月",
    accounts: [account("wechat", "甲号", 200, 1280), account("xhs", "乙号", 20, 2020)],
    contents: [content("wechat", "甲号", "第一篇", 600, 60), content("xhs", "乙号", "一条笔记", 1600, 6, { likes: 10, comments: 2, collects: 4 })],
    channels: [{ platform: "wechat", name: "赛事服务导师招募", count: 12, type: "活动运营" }],
  });

  // 近 1/2/3 月的窗口始终按自然月推，与页面上选的「对比月」无关；compare 只决定缺传警告跟哪个月比。
  const withPrev = await loadReport(B);
  assert.ok(withPrev);
  assert.equal(withPrev!.growth["wechat.reach"]!.g1?.pct, 50, "公众号 400 → 600");
  // 上月只剩公众号、本月两个平台都有 —— 覆盖的平台不一样，总量环比必须留空，
  // 否则 400 → 2200 会算成 +450%，那是"补上了小红书"造成的假增长。
  assert.equal(withPrev!.growth["total.reach"]!.g1, null, "总量环比只在两个月覆盖的平台一致时给出");
  assert.equal(withPrev!.growth["wechat.reach"]!.g1?.pct, 50, "同一个平台自己比，照常给");
  assert.equal(withPrev!.growth["xhs.reach"]!.g1, null, "上月没有小红书的数据 → 不说成从 0 涨起来");
  assert.equal(withPrev!.growth["total.reach"]!.g2, null, "2099-10 没有数据，近 2 月窗口就是「数据不足」");

  const backward = await loadReport(A, B);
  assert.deepEqual(backward!.missingPlatforms, ["xhs"], "对比月有、本月没有的平台要报出来（忘导 sheet 就是这个）");
  assert.deepEqual(backward!.missingAccounts.map((a) => a.account), ["乙号"], "缺到账号一级要列名字");
  assert.equal(backward!.growth["wechat.reach"]!.g1, null, "本月对上月（2099-10 无数据）仍是「数据不足」");
});
