-- 逐条内容的明细。两平台的列不一样：公众号有送达，小红书有观看/点击率/赞评藏，
-- 这里取并集，本平台没有的那几列留 null（不是 0）；raw 存该行的原始单元格，口径改了不用重传。
-- 互动量不落列：公众号=分享、小红书=赞+评+藏+分，是派生值，在读取层算（口径一处定义）。
create table if not exists board_content (
  id bigserial primary key,
  month text not null,
  platform text not null,
  account text not null,
  title text not null,
  published_on date,
  genre text not null default '',
  reach numeric,
  shares numeric,
  new_followers numeric,
  delivered numeric,
  views numeric,
  ctr numeric,
  likes numeric,
  comments numeric,
  collects numeric,
  url text not null default '',
  raw jsonb not null default '{}'
);
