// 站点数据统计：把访客行为与接口调用记下来，在后台出一页报表。
//   - 页面行为来自浏览器里的一个小信标（web.tsx 的 root.Bottom）：不种 cookie，不识别个人。
//   - 接口调用来自 api 进程的全局钩子：机器流量（Agent、RSS、爬虫）只有它看得见。
// 指标：日/周/月/年活跃（去重访客数）、页面访问量、平均浏览时长、接口调用量、热门页面、
//       搜索词、设备、来源。查询在读取时即时聚合（量很小，不建汇总表）。
import { defineModule } from "@aihot/contracts/modules";

export const analyticsModule = defineModule({
  name: "analytics",
  // 信标要经过网页服务器转给 api，所以这个前缀必须交给 api 处理。
  apiPaths: [/^\/api\/analytics(\/|$)/],
  adminPages: [{ path: "admin/analytics", file: "web/admin-analytics.tsx", id: "admin-analytics" }],
});
