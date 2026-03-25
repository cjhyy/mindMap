---
name: mindmap_workflow
version: "1.0.0"
type: workflow
description: "迭代式思维导图展开工作流，指导节点深度扩展"
when_to_use: >
  当用户想要展开特定节点或深入某个知识领域时使用。

triggers:
  keywords:
    - "expand"
    - "drill"
    - "detail"
    - "deeper"
    - "more about"
    - "展开"
    - "详细"
    - "深入"
    - "细化"
    - "拓展"
  intents:
    - "node_expansion"
    - "detail_request"
  tools_mentioned:
    - "get_node"
    - "get_subtree"
    - "update_node"

metadata:
  author: "mindmap_agent"
  priority: 18
  tags: ["workflow", "expansion", "iteration"]
---

# 节点展开工作流

当用户要求展开特定节点时：

1. **定位目标**: 用 `query_graph` 根据关键词找到匹配节点
2. **了解上下文**: 用 `get_node` 查看现有子节点和连接
3. **深入研究**: 搜索该节点主题的详细信息
4. **结构化**: 规划 4-6 个有意义的子主题
5. **创建节点**: 用 `add_nodes_batch` 批量添加子节点
6. **发现连接**: 对每个新节点调用 `find_cross_connections`，创建有意义的边
7. **更新状态**: 用 `update_node(status="expanded")` 标记已展开的节点
8. **展示**: 渲染更新后的子树和全图概览
9. **推荐下一步**: 建议 2-3 个未探索的节点进行后续展开
