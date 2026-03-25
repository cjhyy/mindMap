"""Graph CRUD and rendering endpoints."""

from __future__ import annotations

import asyncio
import json
import sys

from fastapi import APIRouter, HTTPException

from app.config import PROJECT_DIR
from app.schemas import GraphCreate, GraphDetail, GraphMeta
from app.services.graph_service import graph_service

router = APIRouter(prefix="/api/graphs", tags=["graphs"])

# Ensure tools are importable
sys.path.insert(0, str(PROJECT_DIR))


@router.post("", response_model=GraphMeta)
async def create_graph(req: GraphCreate):
    meta = graph_service.create_graph(req.name, req.description)
    return GraphMeta(
        id=meta.id, name=meta.name, description=meta.description,
        node_count=meta.node_count, edge_count=meta.edge_count,
        created_at=meta.created_at, updated_at=meta.updated_at,
    )


@router.get("", response_model=list[GraphMeta])
async def list_graphs():
    metas = graph_service.list_graphs()
    return [
        GraphMeta(
            id=m.id, name=m.name, description=m.description,
            node_count=m.node_count, edge_count=m.edge_count,
            created_at=m.created_at, updated_at=m.updated_at,
        )
        for m in metas
    ]


@router.get("/{graph_id}", response_model=GraphDetail)
async def get_graph(graph_id: str):
    graph = graph_service.get_graph(graph_id)
    if not graph:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return GraphDetail(
        id=graph_id, name=graph.name, description=graph.description,
        node_count=len(graph.nodes), edge_count=len(graph.edges),
        created_at=graph.created_at, updated_at=graph.updated_at,
        graph_data=graph.to_dict(),
    )


@router.delete("/{graph_id}")
async def delete_graph(graph_id: str):
    if not graph_service.delete_graph(graph_id):
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return {"status": "deleted", "graph_id": graph_id}


# ── Rendering endpoints ─────────────────────────────────────


@router.get("/{graph_id}/render/mermaid")
async def render_mermaid(graph_id: str):
    _ensure_graph_path(graph_id)
    from tools.mindmap_renderer_server import render_mermaid as _render
    result = json.loads(await _render())
    return result


@router.get("/{graph_id}/render/markdown")
async def render_markdown(graph_id: str):
    _ensure_graph_path(graph_id)
    from tools.mindmap_renderer_server import render_markdown_outline as _render
    result = json.loads(await _render())
    return result


@router.get("/{graph_id}/render/html")
async def render_html(graph_id: str):
    _ensure_graph_path(graph_id)
    from tools.mindmap_renderer_server import render_html as _render
    result = json.loads(await _render())
    return result


def _ensure_graph_path(graph_id: str) -> None:
    path = graph_service.get_graph_path(graph_id)
    if not path.exists():
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    from tools.mindmap_renderer_server import set_graph_path
    set_graph_path(path)
