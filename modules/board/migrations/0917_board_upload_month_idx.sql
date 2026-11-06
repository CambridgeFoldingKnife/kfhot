-- 后台按月看上传历史（含失败的那些），也是「同月重传要不要保留旧批次」的查询入口。
create index concurrently if not exists board_upload_month_idx on board_upload (month, created_at);
