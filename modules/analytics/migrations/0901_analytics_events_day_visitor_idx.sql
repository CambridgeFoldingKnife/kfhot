-- 按天看活跃与去重访客是报表最常走的路，也是保留期清理的过滤条件。
create index concurrently if not exists analytics_events_day_visitor_idx on analytics_events (day, visitor);
