"""Chat endpoint for clarifying knowledge exploration scope."""

from __future__ import annotations

import json
import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.app.services.graph_service import graph_service

router = APIRouter(tags=["chat"])

SYSTEM_PROMPT = """你是一个学习顾问，帮助用户想清楚他们想探索的知识领域。

通过自然对话了解：
1. 想学什么（可以从模糊开始，比如"AI"、"前端"、"量化交易"）
2. 当前背景（比如：零基础、有编程经验、从其他领域转来）
3. 学习目的（找工作、业余兴趣、项目需要、系统梳理已有知识等）
4. 期望深度（快速入门概览、还是系统深入学习）

对话风格：
- 简洁直接，不啰嗦
- 每次只问一个最关键的问题
- 用用户的语言，不要太正式
- 可以给出具体的例子或选项帮助用户表达
- 2-3轮对话内就应该有足够信息

当你认为信息足够时（必须有主题+大致背景），在回复末尾追加一行：
READY::{"topic":"主题","background":"背景描述","goal":"目的","scope":["子领域1","子领域2","子领域3"]}

scope 是你根据对话推断出的应该覆盖的子领域，3-6个。
READY 行必须是回复的最后一行，前面是正常的对话回复。"""


class ChatMessage(BaseModel):
    role: str  # user | assistant
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream a chat response for knowledge scope clarification."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    base_url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = "anthropic/claude-opus-4.6"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    async def generate():
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": 1000,
                    "temperature": 0.7,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        yield "data: [DONE]\n\n"
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield f"data: {json.dumps({'content': delta}, ensure_ascii=False)}\n\n"
                    except Exception:
                        continue

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Graph-scoped chat & memory persistence ──


class ChatHistoryRequest(BaseModel):
    messages: list[ChatMessage]


class MemoryRequest(BaseModel):
    summary: str = ""
    key_points: list[str] = []
    user_profile: dict | None = None


@router.get("/api/graphs/{graph_id}/chat")
async def get_graph_chat(graph_id: str):
    """Get chat history for a graph."""
    messages = graph_service.get_chat(graph_id)
    return {"messages": messages}


@router.put("/api/graphs/{graph_id}/chat")
async def save_graph_chat(graph_id: str, req: ChatHistoryRequest):
    """Save chat history for a graph."""
    try:
        graph_service.save_chat(
            graph_id,
            [{"role": m.role, "content": m.content} for m in req.messages],
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@router.get("/api/graphs/{graph_id}/memory")
async def get_graph_memory(graph_id: str):
    """Get memory for a graph."""
    return graph_service.get_memory(graph_id)


@router.put("/api/graphs/{graph_id}/memory")
async def save_graph_memory(graph_id: str, req: MemoryRequest):
    """Save memory for a graph."""
    try:
        graph_service.save_memory(graph_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}
