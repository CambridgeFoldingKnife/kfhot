// 公开页 /board「数据统计」：公司自有媒体的月度运营看板。入口在侧边栏「更多」组的最下面，
// 手机端从「我的」页进。看板主体与后台共用 board-view.tsx —— 两边看到的数必须是一样的。
import { useLoaderData } from "react-router";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { SITE } from "@aihot/site";
import type { BoardReport } from "@aihot/board/types";
import { BoardView, MonthPicker } from "./board-view.tsx";

export const handle: Screen = { tab: "me", name: "数据统计" };
export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

type Index = { months: Array<{ month: string; label: string }>; latest: string | null };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const asked = url.searchParams.get("month");
  const compare = url.searchParams.get("compare");
  const index = await loadOr404<Index>("/api/site/board", { signal: request.signal });
  const month = asked && MONTH_RE.test(asked) && index.months.some((m) => m.month === asked) ? asked : index.latest;
  if (!month) return cachedPage(300, { month: null, report: null as BoardReport | null, index });
  const report = await loadOr404<BoardReport>(
    `/api/site/board/${month}${compare && MONTH_RE.test(compare) ? `?compare=${compare}` : ""}`,
    { signal: request.signal },
  );
  return cachedPage(300, { month, report, index });
}

export function meta() {
  return pageMeta({ title: "数据统计", path: "/board", noindex: true, description: `${SITE.name}：自有媒体账号的月度运营数据与跨月对比。` });
}

export default function BoardPage() {
  const { month, report, index } = useLoaderData<typeof loader>();

  if (!report || !month) {
    return (
      <>
        <PhoneBar />
        <EmptyState title="还没有上传过运营数据">
          管理员在后台「数据统计」上传某个月的报表并解析入库后，这里会出现该月的账号、内容、获客与跨月对比。
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PhoneBar />
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="serif-title text-[22px] font-semibold">数据统计 · {report.label}</h1>
            <MonthPicker months={index.months} month={month} />
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-4">
            自有媒体账号（公众号、小红书）的月度运营数据。对比基准是 {report.base.slice(0, 4)}年{Number(report.base.slice(5, 7))}月；
            没有上传的月份与平台不参与环比，也不会被当成 0。
          </p>
        </header>
        <BoardView report={report} months={index.months} />
      </div>
    </>
  );
}
