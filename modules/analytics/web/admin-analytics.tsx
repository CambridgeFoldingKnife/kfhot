// 站点数据页（/admin/analytics）：活跃、访问量、浏览时长、接口调用量，以及热门页面、
// 搜索词、来源、设备。数据来自信标（页面行为）与 api 钩子（接口调用），口径写在页面下方的说明里。
import type { AnalyticsReport } from "@aihot/analytics/backend/report";
import { SITE } from "@aihot/site";
import { useLoaderData } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { num } from "@aihot/web/features/admin/format";
import { AdminPage, Card, DataTable, Empty, FilterChips, Stat, type Column } from "@aihot/web/features/admin/ui";

export async function loader({ request }: { request: Request }): Promise<AnalyticsReport> {
  const days = new URL(request.url).searchParams.get("days") ?? "30";
  return adminGet<AnalyticsReport>(request, `/api/admin/analytics?days=${encodeURIComponent(days)}`);
}

export const meta = () => [{ title: `站点数据 · ${SITE.name} 后台` }];

const secs = (ms: number | null) => (ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} 分` : `${(ms / 1000).toFixed(1)} 秒`);

export default function AdminAnalytics() {
  const r = useLoaderData() as AnalyticsReport;
  const w = r.windowDays;

  return (
    <AdminPage
      title="站点数据"
      subtitle={`近 ${w} 天的访客与接口数据。活跃按「当天去重访客」计算：不种 cookie，访客身份由服务端按（IP + 浏览器 + 当天）临时算出，跨天不可关联，也不存原始 IP。`}
      actions={
        <FilterChips
          param="days"
          options={[
            { value: "7", label: "7 天" },
            { value: "", label: "30 天" },
            { value: "90", label: "90 天" },
            { value: "365", label: "一年" },
          ]}
        />
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="今日活跃访客" value={num(r.active.day)} hint="今天来过的人（去重）" />
          <Stat label="近 7 天活跃" value={num(r.active.week)} hint="过去 7 天去重访客" />
          <Stat label="近 30 天活跃" value={num(r.active.month)} hint="过去 30 天去重访客" />
          <Stat label="近一年活跃" value={num(r.active.year)} hint="过去 365 天去重访客" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="今日页面访问" value={num(r.views.today)} hint={`近 ${w} 天 ${num(r.views.window)} 次`} />
          <Stat label="今日接口调用" value={num(r.api.today)} hint={`近 ${w} 天 ${num(r.api.window)} 次`} />
          <Stat
            label="平均浏览时长"
            value={secs(r.dwell.avgMs)}
            hint={r.dwell.samples ? `${num(r.dwell.samples)} 次样本` : "还没有样本"}
          />
          <Stat
            label="人均浏览页数"
            value={r.sessions.pagesPerSession === null ? "—" : `${r.sessions.pagesPerSession}`}
            hint={`${num(r.sessions.count)} 个会话`}
          />
        </div>

        <Card title={`每日趋势（近 ${w} 天）`}>
          <DataTable<AnalyticsReport["daily"][number]>
            dense
            rows={r.daily}
            rowKey={(d) => d.day}
            empty="还没有数据。信标在有人用浏览器打开页面后才产生记录。"
            columns={[
              { key: "day", label: "日期", render: (d) => <span className="num">{d.day}</span> },
              { key: "visitors", label: "访客", align: "right", render: (d) => <span className="num">{num(d.visitors)}</span> },
              { key: "views", label: "页面访问", align: "right", render: (d) => <span className="num">{num(d.views)}</span> },
              { key: "api", label: "接口调用", align: "right", render: (d) => <span className="num">{num(d.apiCalls)}</span> },
            ]}
          />
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="热门页面">
            <DataTable<AnalyticsReport["topPages"][number]>
              dense
              rows={r.topPages}
              rowKey={(p) => p.path}
              empty="暂无"
              columns={[
                { key: "path", label: "页面", render: (p) => <span className="font-mono text-[12px]">{p.path}</span> },
                { key: "views", label: "访问", align: "right", render: (p) => <span className="num">{num(p.views)}</span> },
              ]}
            />
          </Card>

          <Card title="搜索词">
            <DataTable<AnalyticsReport["topSearches"][number]>
              dense
              rows={r.topSearches}
              rowKey={(s) => s.term}
              empty="暂无"
              columns={[
                { key: "term", label: "词", render: (s) => s.term },
                { key: "views", label: "次数", align: "right", render: (s) => <span className="num">{num(s.views)}</span> },
              ]}
            />
          </Card>

          <Card title="来源（站外）">
            <DataTable<AnalyticsReport["topReferers"][number]>
              dense
              rows={r.topReferers}
              rowKey={(x) => x.host}
              empty="暂无（或都是直接打开）"
              columns={[
                { key: "host", label: "来源", render: (x) => x.host },
                { key: "views", label: "访问", align: "right", render: (x) => <span className="num">{num(x.views)}</span> },
              ]}
            />
          </Card>

          <Card title="设备">
            {r.devices.length === 0 ? (
              <Empty>暂无</Empty>
            ) : (
              <DataTable<AnalyticsReport["devices"][number]>
                dense
                rows={r.devices}
                rowKey={(d) => d.name}
                columns={[
                  { key: "name", label: "类型", render: (d) => d.name },
                  { key: "views", label: "访问", align: "right", render: (d) => <span className="num">{num(d.views)}</span> },
                ]}
              />
            )}
          </Card>
        </div>

        <Card title="接口调用 Top（含 Agent、RSS 与爬虫）">
          <DataTable<AnalyticsReport["apiPaths"][number]>
            dense
            rows={r.apiPaths}
            rowKey={(p) => p.path}
            empty="暂无"
            columns={[
              { key: "path", label: "接口", render: (p) => <span className="font-mono text-[12px]">{p.path}</span> },
              { key: "calls", label: "调用", align: "right", render: (p) => <span className="num">{num(p.calls)}</span> },
            ]}
          />
        </Card>

        <Card title="口径与限制" pad>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-3">
            <li>「活跃」按**当天去重的访客**算；访客身份由服务端按（IP + 浏览器 + 当天）临时算出，**不种 cookie、不存原始 IP、跨天不可关联**。</li>
            <li>同一栋楼共用出口 IP、或换网络，都会让这个数字有偏差 —— 它是**近似日活**，不是精确人数。</li>
            <li>「平均浏览时长」只统计**页面被真正看过**的样本（浏览器在页面隐藏时补报）；后台标签页挂着不动会被计满 30 分钟上限后截断。</li>
            <li>「接口调用」是**所有**打到后端的请求，机器流量（Agent、RSS、爬虫）也在内；路径里的长 id 已归一成 <span className="font-mono">:id</span>。</li>
            <li>页面数据只统计**执行了 JavaScript 的真人浏览器**；爬虫和纯文本抓取不会出现在页面数据里（但会出现在接口调用里）。</li>
            <li>记录保留 {num(400)} 天，之后由每天的保留期任务清理。</li>
          </ul>
        </Card>
      </div>
    </AdminPage>
  );
}
