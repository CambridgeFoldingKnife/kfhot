// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { analyticsWebModule } from "@aihot/analytics/web";

export const WEB_MODULES: readonly WebModule[] = [analyticsWebModule];
