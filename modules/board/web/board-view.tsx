// 看板主体：版式参考 wxAuto/2026年9月…/看板.html（KPI 卡行 → 平台与账号卡 → 每平台内容 TOP 5 →
// 获客环形图与明细），配色沿用本站的暖色 token；平台色保留公众号绿 / 小红书红 —— 那是识别用的，不是主题色。
// 公开页和后台共用这一份；页面上所有环比都是后端算好的字段，浏览器不算增长率。
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import type { AccountRow, BoardGrowth, BoardMetrics, BoardReport, BoardWindow, ContentRow, MetricKey } from "@aihot/board/types";
import { METRIC_KEYS, METRIC_LABELS } from "@aihot/board/types";

const PLATFORMS: Record<string, { label: string; color: string }> = {
  wechat: { label: "公众号", color: "#3E7C6F" },
  xhs: { label: "小红书", color: "#C0574A" },
};
const platformLabel = (p: string) => PLATFORMS[p]?.label ?? p;
const tint = (p: string) => PLATFORMS[p]?.color ?? "#176b75";
const LEAD_COLORS = ["#1F4B43", "#3E7C6F", "#C0574A", "#C9A227", "#7A8B99", "#B0906F"];

export const n = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: digits });

const roundNum = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));

export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${roundNum(Math.abs(v))}%`);

/** 一个增长值：比率出百分点（pp），绝对量出百分比；任一侧缺数据就是「数据不足」，绝不是 0。 */
function Growth({ g, title, size = "sm" }: { g: BoardGrowth | null; title: string; size?: "sm" | "md" }) {
  const text = size === "md" ? "text-[19px]" : "text-[11.5px]";
  const pad = size === "md" ? "px-2.5 py-[2px]" : "px-1.5";
  if (!g) return <span className={`${text} text-ink-4`} title="上月没有可比数据：没上传、或该平台本期缺传">数据不足</span>;
  if (g.kind === "ratio" ? g.diff === 0 : g.pct === 0) return <span className={`${text} text-ink-4`} title={title}>持平</span>;
  const up = g.kind === "ratio" ? (g.diff ?? 0) > 0 : (g.pct ?? 0) > 0;
  const value = g.kind === "ratio" ? `${roundNum(Math.abs(g.diff ?? 0))}pp` : pctText(Math.abs(g.pct ?? 0));
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full ${pad} ${text} font-medium tabular-nums ${up ? "bg-ok-soft text-ok-ink" : "bg-well text-ink-4"}`} title={title}>
      {up ? "↑" : "↓"} {value}
    </span>
  );
}

const WINDOWS: Array<{ key: "g1" | "g2" | "g3"; label: string; title: string }> = [
  { key: "g1", label: "较上月", title: "较上月" },
  { key: "g2", label: "较 2 月前", title: "较两个月前" },
  { key: "g3", label: "较 3 月前", title: "较三个月前" },
];

/** 一张指标表：一行一个指标，三列是近 1 / 2 / 3 个月的增长窗口，最后一列是复合月均。 */
export function GrowthTable({ scope, growth, base }: { scope: string; growth: Record<string, BoardWindow>; base: string }) {
  const keys = METRIC_KEYS.filter((k) => growth[`${scope}.${k}`]);
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] text-ink-4">
          <th className="py-1.5 font-normal">指标</th>
          <th className="py-1.5 text-right font-normal">本期</th>
          <th className="py-1.5 text-right font-normal">较{monthLabel(base)}</th>
          {WINDOWS.filter((w) => w.key !== "g1").map((w) => <th key={w.key} className="py-1.5 text-right font-normal">{w.label}</th>)}
          <th className="py-1.5 text-right font-normal" title="复合月均增长率">月均</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key: MetricKey) => {
          const w = growth[`${scope}.${key}`]!;
          const ratio = w.g1 !== null && w.g1.kind === "ratio";
          return (
            <tr key={key} className="border-t border-line">
              <td className="py-1.5 text-ink-2">{METRIC_LABELS[key]}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{ratio ? `${((w.current ?? 0) * 100).toFixed(2)}%` : n(w.current)}</td>
              <td className="py-1.5 text-right"><Growth g={w.gCompare} title={`较${monthLabel(base)}`} /></td>
              {WINDOWS.filter((col) => col.key !== "g1").map((col) => (
                <td key={col.key} className="py-1.5 text-right">
                  <Growth g={w[col.key]} title={col.title} />
                </td>
              ))}
              <td className="py-1.5 text-right text-[11.5px] tabular-nums text-ink-4" title={w.since ? `起点 ${w.since}` : undefined}>
                {w.cagr === null ? "—" : `${roundNum(w.cagr)}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const shortMonth = (m: string) => `${Number(m.slice(5, 7))}月`;
const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;

/**
 * 月度走势折线图：每月一个点，缺月断开不补 0。纵轴从 0 起（否则小波动会被画成悬崖）。
 * 纯 SVG，不引图表库；宽度撑满卡片、高度固定，点少时把数值标在点上方。
 */
function TrendLine({ title, color, points }: { title: string; color: string; points: Array<{ label: string; value: number | null }> }) {
  const seen = points.map((p) => p.value).filter((v): v is number => v !== null);
  const W = 300;
  const H = 104;
  const PAD = 12;
  const max = Math.max(1, ...seen);
  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const segments: Array<Array<[number, number, number]>> = [];
  let run: Array<[number, number, number]> = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push([x(i), y(p.value), p.value]);
  });
  if (run.length) segments.push(run);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-ink-3">{title}</span>
        <span className="tabular-nums text-ink-4">峰值 {n(max)}</span>
      </div>
      {seen.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-ink-4">暂无数据</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-[132px] w-full" role="img" aria-label={`${title}走势`}>
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="stroke-line" strokeWidth={1} />
          {segments.map((seg, si) => (
            <g key={si}>
              <polyline points={seg.map(([px, py]) => `${px},${py}`).join(" ")} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              {seg.map(([px, py, v], i) => (
                <circle key={i} cx={px} cy={py} r={3} fill={color}>
                  <title>{`${n(v)}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {points.map((p, i) =>
            p.value === null ? null : (
              <text key={i} x={x(i)} y={y(p.value) - 8} textAnchor="middle" className="fill-ink-4 text-[9px]">
                {n(p.value)}
              </text>
            ),
          )}
        </svg>
      )}
      <div className="mt-0.5 flex justify-between text-[10.5px] text-ink-4">
        {points.map((p, i) => <span key={i} className="whitespace-nowrap">{p.label}</span>)}
      </div>
    </div>
  );
}

/** 区块标题：参考看板那条「标题 + 右侧说明」。 */
function SecHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="serif-title text-[16px] font-semibold">{title}</h2>
      {note ? <span className="text-[11.5px] text-ink-4">{note}</span> : null}
    </div>
  );
}

/** 一张 KPI 卡：右上角一抹光晕，数值用等宽数字，脚注放环比。 */
function Kpi({ label, value, unit, foot, glow }: { label: string; value: React.ReactNode; unit?: string; foot: React.ReactNode; glow: string }) {
  return (
    <div className="relative overflow-hidden rounded-card bg-surface px-3.5 py-3 shadow-card">
      <span className="pointer-events-none absolute -right-8 -top-10 size-24 rounded-full opacity-[0.08]" style={{ background: glow }} />
      <div className="text-[11.5px] text-ink-4">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[23px] font-semibold leading-tight tabular-nums">
          {value}
          {unit ? <span className="ml-0.5 text-[12px] font-normal text-ink-4">{unit}</span> : null}
        </span>
        {foot}
      </div>
    </div>
  );
}

/** 获客渠道环形图：纯 SVG，不引图表库；合计放圆心。 */
function Donut({ data, size = 170 }: { data: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 62;
  const C = 2 * Math.PI * R;
  let cursor = 0;
  const arcs = data.map((d) => {
    const len = (d.value / total) * C;
    const arc = { ...d, len, offset: cursor };
    cursor += len;
    return arc;
  });
  return (
    <svg viewBox="0 0 170 170" width={size} height={size} role="img" aria-label={`获客渠道构成，合计 ${total} 条线索`} className="shrink-0">
      <g transform="translate(85 85) rotate(-90)">
        <circle r={R} fill="none" strokeWidth={16} className="stroke-well" />
        {arcs.map((a) => (
          <circle key={a.label} r={R} fill="none" strokeWidth={16} stroke={a.color} strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset} />
        ))}
      </g>
      <text x="85" y="83" textAnchor="middle" className="fill-ink text-[21px] font-semibold tabular-nums">{n(total)}</text>
      <text x="85" y="100" textAnchor="middle" className="fill-ink-4 text-[10.5px]">获客线索</text>
    </svg>
  );
}

const metricValue = (m: BoardMetrics | null | undefined, key: keyof BoardMetrics) => (m ? (m[key] ?? null) : null);

/** 账号行：粉丝数 + 新增，下面一条按最大粉丝归一的条，刻度是上月的位置。 */
function AccountRow({ a, max, prev }: { a: AccountRow; max: number; prev: AccountRow | undefined }) {
  const fans = a.fans_end ?? 0;
  const prevFans = prev?.fans_end ?? null;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="truncate text-ink-2" title={a.name}>{a.name}</span>
        <span className="shrink-0 tabular-nums">
          <b className="font-semibold text-ink">{n(a.fans_end)}</b>
          {a.fans_new === null ? (
            <span className="ml-1.5 text-[11px] text-ink-4">新增待累积</span>
          ) : (
            <span className="ml-1.5 text-[11px] font-semibold" style={{ color: tint(a.platform) }}>+{n(a.fans_new)}</span>
          )}
        </span>
      </div>
      <div className="relative mt-1 h-1 rounded-full bg-well">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (fans / max) * 100)}%`, background: tint(a.platform), opacity: 0.45 }} />
        {prevFans !== null && prevFans > 0 ? (
          <span className="absolute -top-0.5 h-2 w-px bg-ink-3" style={{ left: `${Math.min(100, (prevFans / max) * 100)}%` }} title={`上月 ${n(prevFans)}`} />
        ) : null}
      </div>
    </div>
  );
}

/** 内容榜一行：名次 + 标题 + 一行元信息 + 按阅读/曝光归一的长条。 */
function RankRow({ rank, item, max }: { rank: number; item: ContentRow; max: number }) {
  const meta =
    item.platform === "wechat"
      ? `${item.account} · ${(item.date ?? "").slice(5)} · 分享 ${n(item.shares)} · 关注 ${n(item.new_followers)}`
      : `${item.account} · ${(item.date ?? "").slice(5)} · ${item.genre} · 互动 ${n(item.interaction)} · 涨粉 ${n(item.new_followers)}`;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 w-4 shrink-0 text-[12px] tabular-nums text-ink-4">{rank}</span>
      <div className="min-w-0 flex-1">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12.5px] text-ink hover:text-accent" title={item.title}>
            {item.title || "（无标题）"}
          </a>
        ) : (
          <span className="block truncate text-[12.5px] text-ink" title={item.title}>{item.title || "（无标题）"}</span>
        )}
        <div className="truncate text-[11px] text-ink-4" title={meta}>{meta}</div>
        <div className="mt-1 h-1 rounded-full bg-well">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((item.reach ?? 0) / max) * 100)}%`, background: tint(item.platform), opacity: 0.5 }} />
        </div>
      </div>
      <span className="mt-0.5 w-14 shrink-0 text-right text-[12.5px] font-medium tabular-nums">{n(item.reach)}</span>
    </div>
  );
}

/** 一期的完整看板。公开页和后台都渲染它，所以两边看到的数一定一样。 */
export function BoardView({ report, months }: { report: BoardReport; months: Array<{ month: string; label: string }> }) {
  const total = report.total;
  const growth = report.growth;
  const gBase = (scope: string, key: MetricKey) => growth[`${scope}.${key}`]?.gCompare ?? null;
  const present = report.platforms.filter((p) => p.present);

  const kpis = [
    { label: "阅读 / 曝光", value: n(total.reach), g: gBase("total", "reach") },
    { label: "互动总量", value: n(total.interaction), g: gBase("total", "interaction") },
    { label: "内容带来关注", value: n(total.newFollowers), g: gBase("total", "newFollowers"), sub: `千阅读涨粉 ${n(total.fansPerK, 2)}` },
    { label: "发布内容数", value: n(total.contents), unit: "篇", g: gBase("total", "contents") },
    { label: "获客总数", value: n(total.leads), g: gBase("total", "leads"), sub: total.leads === null ? "获客表未上传" : undefined },
  ];

  return (
    <div className="space-y-7">
      {report.missingPlatforms.length > 0 && (
        <p className="rounded-control bg-note px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          本期缺少的平台：<b>{report.missingPlatforms.map(platformLabel).join("、")}</b> —— 对比月有数据、本月没有上传，
          因此不参与环比（不是归零）。若是漏传，重新上传这个月的总表即可。
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <Kpi
            key={k.label}
            label={k.label}
            value={k.value}
            unit={k.unit}
            glow="#1F4B43"
            foot={k.g ? <Growth g={k.g} size="md" title={`较${monthLabel(report.base)}`} /> : <span className="text-[11.5px] text-ink-4">{k.sub ?? (report.months.length < 2 ? "还没有可比月份" : `与${monthLabel(report.base)}持平或无可比`)}</span>}
          />
        ))}
      </div>

      <section className="space-y-3">
        <SecHead title="平台与账号表现" note="按粉丝规模排序，竖线是上月的位置" />
        <div className="grid gap-3 lg:grid-cols-2">
          {present.map((p) => {
            const accounts = report.accounts.filter((a) => a.platform === p.platform).sort((x, y) => (y.fans_end ?? 0) - (x.fans_end ?? 0));
            const max = Math.max(1, ...accounts.map((a) => a.fans_end ?? 0));
            return (
              <div key={p.platform} className="rounded-card bg-surface p-3.5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium">
                    <span className="size-2 rounded-full" style={{ background: tint(p.platform) }} />
                    {platformLabel(p.platform)}
                  </div>
                  <div className="text-right">
                    <div className="text-[21px] font-semibold leading-tight tabular-nums">{n(p.fansEnd)}</div>
                    <div className="text-[11px] text-ink-4">
                      粉丝规模{p.fansNew === null ? "" : ` · 新增 +${n(p.fansNew)}`}
                      {p.snapshotAccounts < p.accounts ? `（${p.accounts - p.snapshotAccounts} 个账号无快照）` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 border-y border-line py-2">
                  {[
                    { label: "阅读/曝光", value: n(p.reach), color: true },
                    { label: "互动", value: n(p.interaction) },
                    { label: "关注转化", value: n(p.newFollowers) },
                    { label: "发布", value: n(p.contents) },
                  ].map((m) => (
                    <div key={m.label}>
                      <div className="text-[15px] font-semibold tabular-nums" style={m.color ? { color: tint(p.platform) } : undefined}>{m.value}</div>
                      <div className="text-[11px] text-ink-4">{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 divide-y divide-line/60">
                  {accounts.map((a) => (
                    <AccountRow key={a.name} a={a} max={max} prev={report.prevAccounts.find((x) => x.platform === a.platform && x.name === a.name)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SecHead title="内容表现 TOP 5" note="公众号按阅读人数 · 小红书按曝光" />
        <div className="grid gap-3 lg:grid-cols-2">
          {present.map((p) => {
            const items = report.contents.filter((c) => c.platform === p.platform).slice(0, 5);
            const max = Math.max(1, ...items.map((i) => i.reach ?? 0));
            return (
              <div key={p.platform} className="rounded-card bg-surface p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <span className="size-2 rounded-full" style={{ background: tint(p.platform) }} />
                  {platformLabel(p.platform)} · 内容榜
                </div>
                {items.length ? (
                  <div className="mt-1.5 divide-y divide-line/60">
                    {items.map((item, i) => <RankRow key={`${item.account}-${item.title}-${i}`} rank={i + 1} item={item} max={max} />)}
                  </div>
                ) : (
                  <p className="py-6 text-center text-[12.5px] text-ink-4">本月无发表内容</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {report.channelTypes.length > 0 && (
        <section className="space-y-3">
          <SecHead title="获客结构" note={`合计 ${n(report.leadsTotal)} 条线索，按渠道类型归并`} />
          <div className="grid gap-3 lg:grid-cols-[210px_1fr]">
            <div className="flex items-center justify-center rounded-card bg-surface p-3 shadow-card">
              <Donut data={report.channelTypes.map((t, i) => ({ label: t.type, value: t.count, color: LEAD_COLORS[i % LEAD_COLORS.length]! }))} />
            </div>
            <div className="rounded-card bg-surface p-3.5 shadow-card">
              <div className="space-y-1.5">
                {report.channelTypes.map((t, i) => {
                  const share = report.leadsTotal ? Math.round((t.count / report.leadsTotal) * 100) : 0;
                  return (
                    <div key={t.type} className="flex items-center gap-2 text-[12.5px]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: LEAD_COLORS[i % LEAD_COLORS.length] }} />
                      <span className="w-20 shrink-0 text-ink-2">{t.type}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(share, 1.5)}%`, background: LEAD_COLORS[i % LEAD_COLORS.length] }} />
                      </span>
                      <span className="w-10 shrink-0 text-right tabular-nums">{n(t.count)}</span>
                      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-4">{share}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-x-4 gap-y-1 border-t border-line pt-2 sm:grid-cols-2">
                {report.channels.map((c) => (
                  <div key={`${c.platform ?? "x"}-${c.name}`} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="truncate text-ink-3" title={`${c.name}（${c.type}）`}>
                      <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ background: c.platform ? tint(c.platform) : "#B0906F" }} />
                      {c.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-4">{n(c.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SecHead title="跨月对比" note="第一列跟上面的对比基准走；后两列固定跟 2、3 个月前比（累计，不是两段的平均）" />
        <div className="space-y-3">
          <div className="rounded-card bg-surface p-3.5 shadow-card"><GrowthTable scope="total" growth={growth} base={report.base} /></div>
          {present.map((p) => (
            <details key={p.platform} className="rounded-card bg-surface px-3.5 py-2.5 shadow-card">
              <summary className="cursor-pointer text-[13px] font-medium">
                {platformLabel(p.platform)}
                <span className="ml-2 text-[11.5px] font-normal text-ink-4">{p.accounts} 个账号 · {p.contents} 条内容</span>
              </summary>
              <div className="mt-2"><GrowthTable scope={p.platform} growth={growth} base={report.base} /></div>
            </details>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ink-4">
            互动率、分享率、千阅读涨粉是比率，变化按<b>百分点（pp）</b>说；其余按百分比。「月均」是复合月均增长率。
            缺月的窗口一律显示「数据不足」。
          </p>
        </div>
      </section>

      {report.trend.length >= 2 && (
        <section className="space-y-3">
          <SecHead title="走势" note="每月一个点；缺月断开，不补成 0" />
          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { label: "阅读 / 曝光（全部平台）", color: "#1F4B43", values: report.trend.map((t) => metricValue(t.total, "reach")) },
              { label: "新增粉丝（全部平台）", color: "#3E7C6F", values: report.trend.map((t) => metricValue(t.total, "fansNew")) },
              { label: "获客线索（全部平台）", color: "#C0574A", values: report.trend.map((t) => metricValue(t.total, "leads")) },
            ].map((row) => (
              <div key={row.label} className="rounded-card bg-surface p-3 shadow-card">
                <TrendLine title={row.label} color={row.color} points={report.trend.map((t, i) => ({ label: shortMonth(t.month), value: row.values[i] ?? null }))} />
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11.5px] leading-relaxed text-ink-4">
        数据由管理员按月上传各平台后台导出的报表解析而来。互动量按平台各自定义（公众号=分享，小红书=赞+评+藏+分）；
        粉丝新增取快照区，没有快照的账号显示「新增待累积」；缺传的平台与账号不参与环比，也不会被当成 0。
        当前共 {months.length} 个月的数据。
      </p>
    </div>
  );
}

/** 顶部的月份选择：读者和后台用同一个链接形态。 */
export function MonthPicker({ months, month, base = "/board" }: { months: Array<{ month: string; label: string }>; month: string; base?: string }) {
  return (
    <nav className="flex flex-wrap gap-1 text-[12.5px]" aria-label="选择月份">
      {months.map((m) => (
        <IntentLink
          key={m.month}
          to={`${base}?month=${m.month}`}
          preventScrollReset
          aria-current={m.month === month ? "page" : undefined}
          className={`rounded-control px-2.5 py-1 text-[12.5px] ring-1 transition-colors ${
            m.month === month ? "bg-accent-soft text-accent ring-accent/40" : "bg-surface text-ink-3 ring-line hover:text-ink"
          }`}
        >
          {m.label}
        </IntentLink>
      ))}
    </nav>
  );
}
