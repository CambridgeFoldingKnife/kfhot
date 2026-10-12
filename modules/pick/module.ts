// 自动选题：一次给出 N 个「主题 + 方向 + 素材包」，供 agent 的写作流水线直接用。
// 框架只读 site/modules/ 的三份清单，本模块的地址在 index.ts，后端在 server.ts。
import { defineModule } from "@aihot/contracts/modules";

export const pickModule = defineModule({
  name: "pick",
  apiPaths: [/^\/api\/v1\/pick(\/|$)/],
});
