---
name: knowledge_discovery
version: "1.0.0"
type: knowledge
description: "知识发现与领域映射策略，指导系统性地研究新领域并构建知识结构"
when_to_use: >
  当用户想要探索新领域或主题时使用。指导从广泛概览到详细知识点的系统性研究。

triggers:
  keywords:
    - "learn"
    - "study"
    - "explore"
    - "knowledge"
    - "mindmap"
    - "学习"
    - "探索"
    - "了解"
    - "知识图谱"
    - "思维导图"
    - "入门"
    - "路线"
  intents:
    - "knowledge_exploration"
    - "learning_planning"
  tools_mentioned:
    - "create_mindmap"
    - "add_nodes_batch"

metadata:
  author: "mindmap_agent"
  priority: 20
  tags: ["discovery", "research", "learning"]
---

# 知识发现策略

当为用户探索新领域时：

## 第一步：领域分析
- 搜索 "[领域名] 知识体系" 或 "[领域名] 学习路线图"
- 识别主要子领域（通常 5-8 个顶层分类）
- 理解前置知识和学习顺序

## 第二步：结构化映射
- 创建边界清晰的分类
- 每个分类下识别 3-5 个核心概念
- 标注难度级别（如适用）
- 为节点打上领域关键词标签，便于跨领域连接

## 第三步：来源验证
- 优先使用官方文档、权威课程和专家内容
- 重要知识点至少交叉验证 2 个来源
- 在节点元数据中记录来源 URL

## 第四步：展示
- 添加节点后始终渲染思维导图
- 结合用户背景高亮最相关的领域
- 如适用，建议学习顺序
