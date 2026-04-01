"""Agent operation endpoints with SSE streaming."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.app.schemas import (
    AgentCreateRequest,
    AgentExpandRequest,
    AgentExploreRequest,
    AgentQueryRequest,
    OperationResponse,
    OperationStatus,
)
from backend.app.services.agent_service import agent_service

router = APIRouter(tags=["agent"])


# ── Agent operation triggers ────────────────────────────────


@router.post("/api/graphs/{graph_id}/agent/create", response_model=OperationResponse)
async def agent_create(graph_id: str, req: AgentCreateRequest):
    """Start an agent to create the initial knowledge map."""
    task = req.task
    if req.background:
        task = f"我的背景: {req.background}。{task}"

    op = await agent_service.start_operation(graph_id, "create", task)
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/expand", response_model=OperationResponse)
async def agent_expand(graph_id: str, req: AgentExpandRequest):
    """Expand a specific node with AI research."""
    task = (
        f"请展开知识图谱中的「{req.node_label}」节点。"
        f"深入研究这个主题，添加详细的子节点，"
        f"查找与现有节点的跨领域连接，然后展示更新后的导图。"
    )
    op = await agent_service.start_operation(graph_id, "expand", task)
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/query", response_model=OperationResponse)
async def agent_query(graph_id: str, req: AgentQueryRequest):
    """Send a free-form query to the agent about the knowledge graph."""
    op = await agent_service.start_operation(graph_id, "query", req.query)
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/explore", response_model=OperationResponse)
async def agent_explore(graph_id: str, req: AgentExploreRequest):
    """Start an explore operation with user profile from chat clarification."""
    scope_str = "、".join(req.scope) if req.scope else req.topic
    task = f"为用户构建「{req.topic}」的知识图谱，覆盖以下范围：{scope_str}"
    user_profile = {
        "topic": req.topic,
        "background": req.background,
        "goal": req.goal,
        "scope": req.scope,
    }
    op = await agent_service.start_operation(
        graph_id, "explore", task,
        config_name="explore",
        user_profile=user_profile,
    )
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/connect", response_model=OperationResponse)
async def agent_connect(graph_id: str):
    """Find and create cross-domain connections."""
    task = (
        "请分析当前知识图谱中的关键节点，"
        "找出可能的跨领域连接，并创建有意义的边。"
    )
    op = await agent_service.start_operation(graph_id, "connect", task)
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/fill-docs", response_model=OperationResponse)
async def agent_fill_docs(graph_id: str):
    """Batch-generate docs for all nodes that lack documentation."""
    from backend.app.services.graph_service import graph_service
    g = graph_service.get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")

    no_doc = [
        n.label for n in sorted(
            (n for n in g.nodes.values() if not n.has_doc and n.level >= 1),
            key=lambda n: n.level,
        )
    ]
    if not no_doc:
        raise HTTPException(400, "所有节点已有文档")

    # Build node list with IDs for the agent
    no_doc_items = [
        n for n in sorted(
            (n for n in g.nodes.values() if not n.has_doc and n.level >= 1),
            key=lambda n: n.level,
        )
    ]
    node_list = "\n".join(f"- {n.label}（node_id: {n.id}）" for n in no_doc_items[:30])

    task = (
        f"⚠ 忽略 system prompt 中的阶段规划。本次任务只有一个目标：生成文档。\n\n"
        f"请为以下 {len(no_doc_items)} 个节点生成文档（每篇 300-500 字）。\n"
        f"每个 turn 调用 `generate_node_doc`，不要调用 `add_node`、`add_nodes_batch`、`add_edge`、`delete_node`。\n"
        f"不要调用 `get_graph_summary`、`get_subtree`，直接生成文档。\n\n"
        f"节点列表：\n{node_list}"
    )
    op = await agent_service.start_operation(graph_id, "fill-docs", task, config_name="filldocs")
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/auto", response_model=OperationResponse)
async def agent_auto(graph_id: str):
    """Auto-continue: check graph state and do whatever is needed next.

    The agent sees the key-map and decides autonomously:
    - If empty → create skeleton
    - If unexplored nodes → expand them
    - If no docs on core nodes → generate docs
    """
    from backend.app.services.graph_service import graph_service
    g = graph_service.get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")

    if not g.nodes:
        task = "知识图谱为空，请按照阶段规划从头创建"
    else:
        unexplored = sum(1 for n in g.nodes.values() if n.status.value == "unexplored")
        no_doc = sum(1 for n in g.nodes.values() if not n.has_doc and n.level >= 1)

        if unexplored > 0:
            task = f"继续展开 {unexplored} 个未探索节点，用 add_nodes_batch 批量添加子节点，然后用 update_node 标记状态"
        elif no_doc > 0:
            task = (
                f"⚠ 跳过阶段一二，直接进入阶段三。\n"
                f"为 {no_doc} 个缺文档的节点生成文档，每个 turn 调用 generate_node_doc"
            )
        else:
            task = "图谱已完善。用 get_subtree 检查结构，去重，补漏，更新节点状态"

    op = await agent_service.start_operation(graph_id, "auto", task)
    return _op_response(op)


# ── Operation management ────────────────────────────────────


@router.get("/api/operations/{op_id}", response_model=OperationStatus)
async def get_operation(op_id: str):
    """Get the status of an operation."""
    op = agent_service.get_operation(op_id)
    if not op:
        raise HTTPException(404, f"Operation '{op_id}' not found")
    return _op_status(op)


@router.delete("/api/operations/{op_id}", response_model=OperationStatus)
async def cancel_operation(op_id: str):
    """Cancel a running operation."""
    op = await agent_service.cancel_operation(op_id)
    if not op:
        raise HTTPException(404, f"Operation '{op_id}' not found")
    return _op_status(op)


@router.get("/api/operations", response_model=list[OperationStatus])
async def list_operations(graph_id: str | None = None):
    """List operations, optionally filtered by graph_id."""
    ops = agent_service.list_operations(graph_id)
    return [_op_status(op) for op in ops]


# ── SSE streaming ───────────────────────────────────────────


@router.get("/api/operations/{op_id}/stream")
async def stream_operation(op_id: str):
    """SSE endpoint for streaming agent progress."""
    op = agent_service.get_operation(op_id)
    if not op:
        raise HTTPException(404, f"Operation '{op_id}' not found")

    async def event_generator():
        sent_done = False
        while not sent_done:
            try:
                msg = await asyncio.wait_for(op.stream_queue.get(), timeout=2.0)

                if isinstance(msg, dict):
                    event_type = msg.get("type", "message")
                    data = json.dumps(msg, ensure_ascii=False, default=str)
                else:
                    event_type = "message"
                    data = json.dumps({"content": str(msg)}, ensure_ascii=False)

                yield f"event: {event_type}\ndata: {data}\n\n"

                # End stream on terminal events
                if event_type in ("done", "cancelled"):
                    sent_done = True

            except asyncio.TimeoutError:
                yield f"event: heartbeat\ndata: {{}}\n\n"

                # If operation finished but "done" event was missed, send it now
                if op.status in ("completed", "cancelled", "failed") and op.duration_seconds is not None:
                    final = json.dumps({
                        "status": op.status,
                        "duration": op.duration_seconds,
                        "result": op.result[:500] if op.result else None,
                        "error": op.error,
                    }, ensure_ascii=False)
                    yield f"event: done\ndata: {final}\n\n"
                    sent_done = True

            except Exception:
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Helpers ─────────────────────────────────────────────────


def _op_response(op) -> OperationResponse:
    return OperationResponse(
        operation_id=op.id,
        graph_id=op.graph_id,
        status=op.status,
        stream_url=f"/api/operations/{op.id}/stream",
    )


def _op_status(op) -> OperationStatus:
    return OperationStatus(
        operation_id=op.id,
        graph_id=op.graph_id,
        operation_type=op.operation_type,
        status=op.status,
        result=op.result,
        duration_seconds=op.duration_seconds,
        turns=op.turns,
        tool_calls=op.tool_calls,
        error=op.error,
    )
