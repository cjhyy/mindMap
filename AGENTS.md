# MindMap Agent

## Background

MindMap Agent 是一个 AI 驱动的知识图谱构建工具。用户描述想学习的主题，Agent 自动生成结构化的思维导图骨架，并为每个知识节点生成独立的 Markdown 文档（类似掘金文章质量）。

**产品愿景**：天文体星系模型 — 每个知识点是一颗星球，可以无限深入探索，不断扩展个人知识边界。

### 核心工作流

1. 用户描述学习目标 + 背景 + 期望
2. LLM 对话澄清理解，建议 3-6 个学习模块（scope）
3. 用户选择 scope 后，Agent 自动构建知识图谱骨架
4. Agent 为每个节点生成 300-500 字的 Markdown 文档
5. 用户可以对任意节点继续探索（expand），生成子图谱
6. 所有数据可保存、恢复、导出

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Zustand + Tailwind CSS + shadcn/ui
- **Editor**: Tiptap (飞书风格 WYSIWYG)，后端存储 Markdown 字符串
- **Backend**: Python 3.12+ / FastAPI + Uvicorn
- **Agent**: mem-deep-research (自定义 LLM Agent 框架)
- **LLM**: OpenRouter API
- **Search**: Serper API
- **Storage**: 文件系统 JSON（每个图谱一个目录，含 graph.json + docs/）
- **Mobile**: Flutter（脚手架阶段）

## Project Structure

```
mindMap/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 入口 + CORS
│   │   ├── config.py         # 路径与配置
│   │   ├── schemas.py        # Pydantic 模型
│   │   ├── routers/          # graphs, nodes, agent, chat, markdown
│   │   └── services/         # graph_service, agent_service
│   ├── tools/
│   │   ├── models.py         # KnowledgeNode, KnowledgeEdge, KnowledgeGraph
│   │   └── mindmap_manager_server.py  # MCP 工具
│   └── config/prompts/       # Agent system prompts
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── layout/AppShell.tsx     # 三栏布局主框架
│       │   ├── explore/ExploreModal.tsx # 探索对话 + scope 选择
│       │   ├── document/               # DocumentView, TiptapEditor, AiPanel
│       │   ├── nodes/NodeTree.tsx       # 侧边栏节点树
│       │   └── agent/AgentBar.tsx       # Agent 控制栏
│       ├── stores/graphStore.ts        # Zustand 全局状态
│       ├── api/client.ts               # 后端通信
│       ├── types/index.ts              # TypeScript 类型
│       └── hooks/useOperation.ts       # SSE 流式操作
├── data/graphs/              # 图谱数据存储
├── mobile/                   # Flutter 移动端
└── pyproject.toml
```

## Commands

```bash
# 后端
cd backend && uvicorn app.main:app --reload --port 8000

# 前端
cd frontend && npm run dev

# 构建
cd frontend && npm run build

# Lint
cd frontend && npm run lint
```

## Architecture Notes

- **Agent 四阶段执行**：骨架构建 → 跨域连接 → 文档生成（子 Agent 并行） → 清理去重
- **READY:: 协议**：Agent 通过 `READY::` 前缀 JSON 信号通知前端 scope 选择完成
- **SSE 流式进度**：前端通过 `useOperation` hook 订阅 Agent 事件（started, turn_end, tool_call, done, cancelled）
- **原子文件写入**：防止并发更新导致数据损坏
- **Key-map 自主决策**：Agent 根据节点树 + 状态标记自主判断哪些节点需要填充，不需要用户手动编排
