-- 分析的展示结构（关键变化卡片 + 分段解读 + 编号建议）。
-- 正文 body 仍保留纯文本版本，供导出/回退；页面优先渲染 data。
alter table board_analysis add column data jsonb not null default '{}'::jsonb;
