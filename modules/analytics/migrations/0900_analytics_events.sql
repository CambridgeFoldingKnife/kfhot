-- 页面行为事件：一条「看了一页」或「离开一页」。
-- 访客标识由服务端按（访客 IP + User-Agent + 当日盐）哈希得出：不落原始 IP、不种 cookie。
-- leave 事件由浏览器在页面隐藏时补发，带上停留时长（dwell_ms）与最大滚动深度（scroll）。
-- search 存站内搜索词（只在这一页有），路径列因此始终是干净的去查询串路径。
-- day 由应用按北京时间写死，便于按天聚合与保留期清理。
create table if not exists analytics_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  day date not null,
  kind text not null,
  path text not null,
  visitor text not null,
  session text not null,
  referer text,
  ua text,
  lang text,
  screen text,
  search text,
  dwell_ms integer,
  scroll smallint
);
