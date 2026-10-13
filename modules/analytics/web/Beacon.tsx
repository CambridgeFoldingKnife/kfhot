// 页面信标：进入一页发一条 view；页面隐藏或离开时补一条 leave（停留时长 + 最大滚动深度）。
// 不种 cookie、不读 localStorage：会话号只放在 sessionStorage，访客标识由服务端按（IP+UA+当天）算出。
// 机器人和脚本不执行这里的代码，所以页面数据天然只统计真人。
import { useEffect } from "react";
import { useLocation } from "react-router";

const ENDPOINT = "/api/analytics/collect";
const SESSION_KEY = "kf-analytics-session";

function sessionId(): string {
  const fresh = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = fresh();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

function send(payload: Record<string, unknown>, onLeave: boolean): void {
  const body = JSON.stringify(payload);
  try {
    if (onLeave && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    });
  } catch {
    // 信标失败不影响页面。
  }
}

/** 挂在每个公开页面上（web.tsx 的 root.Bottom）；管理端不会加载它。 */
export function Beacon() {
  const location = useLocation();

  useEffect(() => {
    const session = sessionId();
    const path = location.pathname;
    const search = new URLSearchParams(location.search).get("q")?.trim() || null;
    const started = Date.now();
    let maxScroll = 0;
    let sent = false;

    send(
      {
        kind: "view",
        path,
        session,
        search,
        referer: document.referrer || null,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`,
      },
      false,
    );

    const onScroll = () => {
      const el = document.documentElement;
      const scrollable = el.scrollHeight - el.clientHeight;
      const pct = scrollable > 0 ? Math.round((el.scrollTop / scrollable) * 100) : 100;
      if (pct > maxScroll) maxScroll = pct;
    };
    const leave = () => {
      if (sent) return;
      sent = true;
      send({ kind: "leave", path, session, dwellMs: Date.now() - started, scroll: maxScroll }, true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      // 站内跳转是客户端路由，页面不会卸载重建：这里补上上一页的离开事件。
      leave();
    };
  }, [location.pathname, location.search]);

  return null;
}
