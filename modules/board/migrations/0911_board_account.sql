-- 账号级的粉丝快照，一月一行一账号。来源是总表里「平台-账号」那个 sheet 的快照区。
-- fans_new 可空：小红书普遍没有增量快照，空在页面上是「新增待累积」，绝不能当成 0 去算环比。
-- 同月重传整月替换，所以 (month, platform, account) 就是主键，不用另建唯一索引。
create table if not exists board_account (
  month text not null,
  platform text not null,
  account text not null,
  start_date date,
  end_date date,
  fans_start numeric,
  fans_end numeric,
  fans_new numeric,
  raw jsonb not null default '{}',
  primary key (month, platform, account)
);
