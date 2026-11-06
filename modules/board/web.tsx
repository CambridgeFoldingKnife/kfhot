// 看板接进网页的三个口子：
//   sidebar —— 公开页「数据统计」，声明并入引擎的「更多」组，所以它落在侧栏最下面（见 nav.ts）。
//   tools   —— 手机端不占底栏第 5 格，进「我的」页第一行。
//   admin   —— 后台自己的分组，上传与月度分析都在这儿。
import { defineWebModule } from "@aihot/web/modules";
import { IconChart } from "@aihot/web/components/icons";

export const boardWebModule = defineWebModule({
  name: "board",
  sidebar: { section: "更多", items: [{ to: "/board", label: "数据统计", icon: IconChart }] },
  tools: [{ to: "/board", label: "数据统计", icon: <IconChart size={20} /> }],
  admin: {
    groups: [{ group: "数据统计", items: [{ to: "/admin/board", label: "看板与上传" }] }],
  },
});
