// 数据统计看板：管理员每月上传各平台的运营报表，解析入库，公开页按月展示并做跨月环比。
//   地址在 index.ts 登记，后端在 server.ts，页面部件在 web.tsx；数据表在 migrations/0910–0917。
// 与资讯侧完全独立：不读 item 表，也不参与热点榜与日报。
import { defineModule } from "@aihot/contracts/modules";

export const boardModule = defineModule({
  name: "board",
  // 公开页在 /board，后台页在 /admin/board（登录守卫由后台 layout 负责）。
  pages: [{ path: "board", file: "web/board.tsx", id: "board" }],
  adminPages: [{ path: "admin/board", file: "web/admin-board.tsx", id: "admin-board" }],
});
