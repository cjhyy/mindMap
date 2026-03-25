---
name: knowledge_interconnection
version: "1.0.0"
type: knowledge
description: "跨领域知识连接识别，分析不同知识区域之间的关系"
when_to_use: >
  当分析不同知识领域之间的关系时，或当用户有足够多的节点可以进行跨领域连接时使用。

triggers:
  keywords:
    - "connection"
    - "relationship"
    - "link"
    - "relate"
    - "关联"
    - "连接"
    - "联系"
    - "关系"
    - "cross-domain"
    - "跨领域"
    - "串联"
  intents:
    - "knowledge_connection"
    - "cross_reference"
  tools_mentioned:
    - "find_cross_connections"
    - "add_edge"

metadata:
  author: "mindmap_agent"
  priority: 15
  tags: ["interconnection", "graph", "cross-domain"]
---

# 知识互联策略

## 要寻找的连接类型

1. **前置依赖**: 主题 A 必须在主题 B 之前学习
   - 边类型: `prerequisite`
   - 示例: "Python 基础" → "LLM API 调用"

2. **跨领域应用**: 相同概念在不同场景中的应用
   - 边类型: `cross_domain`
   - 示例: "Python" 同时连接到 "数据处理" 和 "Web 爬虫"

3. **互补知识**: 相互增进理解的主题
   - 边类型: `related`
   - 示例: "Prompt Engineering" ↔ "Token 经济学"

## 执行流程
1. 展开节点后，始终调用 `find_cross_connections`
2. 评估每个建议的连接：对学习是否有意义？
3. 只为真正有用的连接创建边
4. 向用户展示时，解释连接存在的原因
