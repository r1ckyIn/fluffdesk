# 测试集

一行一个 JSON（jsonl）。来源三种，`source` 字段标明：
- `seed`：开工时手写的
- `correction`：美容师在后台改过的（识图、报价、回复），由脚本从 corrections 表导出
- `live`：线上失败案例回流

字段：
```
id        唯一
source    seed | correction | live
shop      店铺 slug（fixture 里要有）
locale    en | zh
turns     [{ text, images? }]   客人逐轮输入
expect    确定性检查，见 graders/deterministic.ts
judge     可选，给模型评审的评分标准（自然语言）
```
改了提示词或工具，先跑 `npm run eval -- quote`，分数掉了不许合。
