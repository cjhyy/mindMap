"""Agent operation endpoints with SSE streaming."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas import (
    AgentCreateRequest,
    AgentExpandRequest,
    AgentQueryRequest,
    OperationResponse,
    OperationStatus,
)
from app.services.agent_service import agent_service

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


@router.post("/api/graphs/{graph_id}/agent/connect", response_model=OperationResponse)
async def agent_connect(graph_id: str):
    """Find and create cross-domain connections."""
    task = (
        "请分析当前知识图谱中的关键节点，"
        "找出可能的跨领域连接，并创建有意义的边。"
    )
    op = await agent_service.start_operation(graph_id, "connect", task)
    return _op_response(op)


@router.post("/api/graphs/{graph_id}/agent/auto", response_model=OperationResponse)
async def agent_auto(graph_id: str):
    """Auto-continue: check graph state and do whatever is needed next.

    The agent sees the key-map and decides autonomously:
    - If empty → create skeleton
    - If unexplored nodes → expand them
    - If no docs on core nodes → generate docs
    """
    from app.services.graph_service import graph_service
    g = graph_service.get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")

    if not g.nodes:
        task = "知识图谱为空，请创建完整骨架"
    else:
        unexplored = sum(1 for n in g.nodes.values() if n.status.value == "unexplored")
        no_doc = sum(1 for n in g.nodes.values()
                     if n.status.value != "unexplored" and not n.has_doc and n.level >= 1)
        parts = ["继续完善知识图谱"]
        if unexplored > 0:
            parts.append(f"展开 {unexplored} 个未探索节点")
        if no_doc > 0:
            parts.append(f"为 {no_doc} 个核心节点生成文档")
        if unexplored == 0 and no_doc == 0:
            parts = ["图谱已完善，检查是否有可以深化的知识点"]
        task = "，".join(parts)

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
