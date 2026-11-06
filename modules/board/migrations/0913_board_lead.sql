-- 获客渠道明细，一月一条渠道一行。合计不落列：读取层 sum(count)，避免表和明细两处各说一个数。
-- channel_type 不加 CHECK：以后加一类渠道（比如直播）不该需要改表。
-- platform 可空：获客表里若有渠道上面没有「公众号/小红书」分组名，平台留空并给警告。
create table if not exists board_lead (
  id bigserial primary key,
  month text not null,
  platform text,
  channel text not null,
  channel_type text not null default '其他',
  count integer not null default 0,
  raw jsonb not null default '{}'
);
