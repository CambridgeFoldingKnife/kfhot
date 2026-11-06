-- 趋势线和渠道构成都要按月拿全部渠道。
create index concurrently if not exists board_lead_month_idx on board_lead (month);
