-- 看板按「某月某平台」取明细是页面上每一次渲染都走的路。
create index concurrently if not exists board_content_month_idx on board_content (month, platform, account);
