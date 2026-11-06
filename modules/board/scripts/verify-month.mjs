// 每月上传前自检：总表 vs 分账号文件逐条对账、异常值、缺日期行、月份反查、缺分表账号。
// 用法：node modules/board/scripts/verify-month.mjs --dir "D:/.../2026年10月小红书+公众号数据汇总"
// 退出码：0 = 全部通过（有警告但没阻断项），1 = 发现对不上（别上传）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readBook, parseMaster, parseLeads, checkMonth } from '../backend/parse.ts';

const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
if (dirArg < 0 || !args[dirArg + 1]) {
  console.error('用法：node modules/board/scripts/verify-month.mjs --dir <月份文件夹>');
  process.exit(2);
}
const find = (root, keyword) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const hit = find(full, keyword);
      if (hit) return hit;
    } else if (entry.name.includes(keyword) && /\.xlsx?$/i.test(entry.name) && !entry.name.startsWith('~$')) {
      return full;
    }
  }
  return null;
};
const dir = args[dirArg + 1];
const leadsPath = find(dir, '获客');
// 「总表」这个词同时出现在获客汇总的文件名里，所以按"能解析出账号"来挑，而不是按名字猜。
const masterCandidates = [];
const collect = (root) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/(总表|阅读)/.test(entry.name) && /\.xlsx?$/i.test(entry.name) && !entry.name.startsWith('~$')) masterCandidates.push(full);
  }
};
collect(dir);
let masterPath = null;
let master = null;
for (const candidate of masterCandidates) {
  const parsed = parseMaster(readBook(readFileSync(candidate)));
  if (parsed.accounts.length > 0) {
    masterPath = candidate;
    master = parsed;
    break;
  }
}
if (!masterPath || !master) {
  console.error(`✗ ${dir} 里找不到能解析出账号的总表（看了：${masterCandidates.map((c) => path.basename(c)).join('、') || '无'}）`);
  process.exit(1);
}
const leads = leadsPath ? parseLeads(readBook(readFileSync(leadsPath))) : null;
let bad = 0;

console.log(`总表：${path.basename(masterPath)}`);
console.log(`  ${master.accounts.length} 个账号 · ${master.contents.length} 条内容 · 跳过 ${master.skipped.length} · 警告 ${master.warnings.length} · 错误 ${master.errors.length}`);
for (const e of master.errors) { bad++; console.log(`  ✗ ${e.sheet ? `〔${e.sheet}〕` : ''}${e.message}`); }
for (const w of master.warnings) console.log(`  ⚠ ${w.sheet ? `〔${w.sheet}〕` : ''}${w.message}`);
for (const s of master.skipped.slice(0, 10)) console.log(`  ⚠ 跳过〔${s.sheet}〕第 ${s.row} 行「${s.title}」：${s.reason}`);
if (master.skipped.length > 10) console.log(`  ⚠ ……共跳过 ${master.skipped.length} 行`);

const monthArgIndex = args.indexOf('--month');
const monthArg = monthArgIndex >= 0 ? args[monthArgIndex + 1] : undefined;
if (master.snapshot) console.log(`  快照期末：${master.snapshot.max}`);
if (monthArg) {
  const issue = checkMonth(master.snapshot, monthArg);
  if (issue) { bad++; console.log(`  ✗ 月份反查（${monthArg}）：${issue.message}`); }
  else console.log(`  月份反查：按 ${monthArg} 上传可以通过`);
}

// 逐账号对账：把分表当成"只有一个 sheet 的总表"解析，用同一套规则
const n = (v) => (v ?? 0);
const sum = (list, key) => list.reduce((s, c) => s + n(c[key]), 0);
const sig = (c) => `${c.date}|${c.title}|${c.reach}|${c.shares}|${c.new_followers}|${c.platform === 'wechat' ? c.delivered : c.views}`;
const perAccountFiles = [];
const walk = (root) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/^(公众号|小红书)-.+\.xlsx?$/i.test(entry.name) && !entry.name.startsWith('~$')) perAccountFiles.push(full);
  }
};
walk(dir);

console.log(`\n逐账号对账（分表 ${perAccountFiles.length} 个）：`);
const seen = new Set();
for (const file of perAccountFiles) {
  const m = /^(公众号|小红书)-(.+?)\.xlsx?$/i.exec(path.basename(file));
  if (!m) continue;
  const platform = m[1] === '公众号' ? 'wechat' : 'xhs';
  const account = m[2];
  seen.add(`${platform}|${account}`);
  const book = readBook(readFileSync(file));
  const parsed = parseMaster({ ...book, sheets: [{ ...book.sheets[0], name: `${m[1]}-${account}` }] });
  const mine = parsed.contents;
  const inMaster = master.contents.filter((c) => c.platform === platform && c.account === account);
  const pool = [...inMaster];
  const onlyMine = [];
  for (const c of mine) {
    const i = pool.findIndex((x) => sig(x) === sig(c));
    if (i >= 0) pool.splice(i, 1);
    else onlyMine.push(c);
  }
  const ok = mine.length === inMaster.length && pool.length === 0 && onlyMine.length === 0
    && sum(mine, 'reach') === sum(inMaster, 'reach') && sum(mine, 'shares') === sum(inMaster, 'shares');
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${m[1]}-${account}：分表 ${mine.length} 条(${sum(mine, 'reach')}) / 总表 ${inMaster.length} 条(${sum(inMaster, 'reach')})`);
  for (const c of onlyMine.slice(0, 3)) console.log(`      只在分表：${c.date} ${String(c.title).slice(0, 30)} 阅读 ${c.reach}`);
  for (const c of pool.slice(0, 3)) console.log(`      只在总表：${c.date} ${String(c.title).slice(0, 30)} 阅读 ${c.reach}`);
}
const orphans = master.accounts.filter((a) => !seen.has(`${a.platform}|${a.name}`));
if (orphans.length) console.log(`  没有对应分表的账号（只有快照是正常的）：${orphans.map((a) => `${a.platform}/${a.name}（内容 ${master.contents.filter((c) => c.platform === a.platform && c.account === a.name).length} 条）`).join('；')}`);

if (leads) {
  console.log(`\n获客表：${leads.channels.length} 条渠道，合计 ${leads.total}${leads.errors.length ? ` · 错误 ${leads.errors.length}` : ''}`);
  for (const w of leads.warnings) console.log(`  ⚠ ${w.message}`);
  if (leads.errors.length) bad++;
}

console.log(bad ? `\n✗ 有 ${bad} 项需要处理，先别上传` : '\n✓ 对账通过');
process.exit(bad ? 1 : 0);
