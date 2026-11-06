-- 看板的一月一行：数据看板的锚点。month 用 'YYYY-MM'，由上传时在页面上选定，
-- 并按总表里的粉丝快照日期反查校验（防止把 10 月的表盖进 9 月）。
-- 模型月度解读的列由 P2 自己的迁移加（框架规定：没有代码读写的列不进库）。
create table if not exists board_month (
  month text primary key,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
