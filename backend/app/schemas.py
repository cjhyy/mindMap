"""Pydantic request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Graph schemas ───────────────────────────────────────────


class GraphCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=2000)


class GraphMeta(BaseModel):
    id: str
    name: str
    description: str
    node_count: int
    edge_count: int
    created_at: str
    updated_at: str


class GraphDetail(GraphMeta):
    graph_data: dict


# ── Agent operation schemas ─────────────────────────────────


class AgentCreateRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=5000)
    background: str = Field("", max_length=2000)


class AgentExpandRequest(BaseModel):
    node_label: str


class AgentQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=5000)


class OperationResponse(BaseModel):
    operation_id: str
    graph_id: str
    status: str
    stream_url: str


class OperationStatus(BaseModel):
    operation_id: str
    graph_id: str
    operation_type: str
    status: str
    result: str | None = None
    duration_seconds: float | None = None
    turns: int | None = None
    tool_calls: int | None = None
    error: str | None = None


# ── Node schemas ────────────────────────────────────────────


class NodeConnection(BaseModel):
    edge_id: str
    node_id: str
    label: str
    edge_type: str
    edge_label: str


class NodeDetail(BaseModel):
    id: str
    label: str
    description: str
    domain: str
    level: int
    status: str
    tags: list[str]
    source_urls: list[str]
    parent_id: str | None
    created_at: str
    updated_at: str
    children: list[dict]
    cross_connections: list[NodeConnection]


class NodeUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    domain: str | None = None
    tags: list[str] | None = None
    source_urls: list[str] | None = None
    status: str | None = None


class NodeListItem(BaseModel):
    id: str
    label: str
    domain: str
    level: int
    status: str
    parent_id: str | None
    children_count: int
    description: str


# ── Markdown schemas ────────────────────────────────────────


class MarkdownExport(BaseModel):
    content: str
    node_count: int
    edge_count: int


class MarkdownImportRequest(BaseModel):
    content: str


class MarkdownImportResult(BaseModel):
    nodes_updated: int
    nodes_added: int
    errors: list[str]
