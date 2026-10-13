-- 接口调用量：按（日、路径、方法、状态）累加，一行一桶。
-- 路径里的长 id（文章/事件 id）在写入前归一成 :id，行数因此有界，不会随内容增长。
create table if not exists analytics_api_daily (
  day date not null,
  path text not null,
  method text not null,
  status smallint not null,
  calls bigint not null default 0,
  primary key (day, path, method, status)
);
