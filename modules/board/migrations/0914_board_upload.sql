-- 每次上传留一行：一个批次（一次请求里的总表 + 获客表）共用一个 batch。
-- 这张表是「进库」换来的东西——传错了要能回答是谁在什么时候传的哪个文件、当时解析掉了几行、
-- 解析器警告过什么；原始文件按 content-hashed 名字存在 /data 的上传目录里，这里只记 sha256。
create table if not exists board_upload (
  id bigserial primary key,
  batch text not null,
  month text not null,
  kind text not null,
  filename text not null,
  bytes integer not null,
  sha256 text not null,
  rows_ok integer not null default 0,
  rows_skipped integer not null default 0,
  skipped jsonb not null default '[]',
  warnings jsonb not null default '[]',
  status text not null default 'ok',
  error text,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
