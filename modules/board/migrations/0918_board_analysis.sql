-- 月度 AI 分析：一月一份，默认草稿；管理员在后台看过点「发布」才出现在公开页。
-- 单独一张表而不是往 board_month 加列：分析是"一次生成物"，和月份本身的属性分开更清楚，
-- 也避免给 board_month 加一串多数时候为空的分析列。
create table if not exists board_analysis (
  month text primary key,
  body text not null default '',
  model text,
  prompt text,
  published boolean not null default false,
  published_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
