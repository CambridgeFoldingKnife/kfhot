// 站点数据统计接进网页的两个口子：
//   root.Bottom —— 每个公开页面挂一枚信标（管理端不加载，框架自己保证）
//   admin.content —— 后台「内容」分组里的一个入口，指向本站的数据页
import { defineWebModule } from "@aihot/web/modules";
import { Beacon } from "./web/Beacon.tsx";

export const analyticsWebModule = defineWebModule({
  name: "analytics",
  root: { Bottom: Beacon },
  admin: {
    content: [{ to: "/admin/analytics", label: "站点数据" }],
  },
});
