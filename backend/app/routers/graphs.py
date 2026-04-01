"""Graph CRUD and rendering endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from backend.app.config import PROJECT_DIR
from backend.app.schemas import GraphCreate, GraphDetail, GraphMeta
from backend.app.services.graph_service import graph_service

router = APIRouter(prefix="/api/graphs", tags=["graphs"])



@router.post("", response_model=GraphMeta)
async def create_graph(req: GraphCreate):
    try:
        meta = graph_service.create_graph(req.name, req.description)
    except ValueError as e:
        raise HTTPException(400, str(e))
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
    graph = _load_graph(graph_id)
    return GraphDetail(
        id=graph_id, name=graph.name, description=graph.description,
        node_count=len(graph.nodes), edge_count=len(graph.edges),
        created_at=graph.created_at, updated_at=graph.updated_at,
        graph_data=graph.to_dict(),
    )


@router.delete("/{graph_id}")
async def delete_graph(graph_id: str):
    try:
        if not graph_service.delete_graph(graph_id):
            raise HTTPException(404, f"Graph '{graph_id}' not found")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "deleted", "graph_id": graph_id}


# ── Rendering endpoints ─────────────────────────────────────
# These load the graph directly per-request to avoid global state races.


@router.get("/{graph_id}/render/mermaid")
async def render_mermaid(graph_id: str, max_depth: int = 3):
    g = _load_graph(graph_id)
    try:
        from backend.tools.mindmap_renderer_server import set_graph_path
        set_graph_path(graph_service.get_graph_path(graph_id))
        from backend.tools.mindmap_renderer_server import render_mermaid as _render
        result = json.loads(await _render(max_depth=max_depth))
    except Exception as e:
        raise HTTPException(500, f"Render failed: {e}")
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/{graph_id}/render/markdown")
async def render_markdown(graph_id: str, max_depth: int = 4):
    g = _load_graph(graph_id)
    try:
        from backend.tools.mindmap_renderer_server import set_graph_path
        set_graph_path(graph_service.get_graph_path(graph_id))
        from backend.tools.mindmap_renderer_server import render_markdown_outline as _render
        result = json.loads(await _render(max_depth=max_depth))
    except Exception as e:
        raise HTTPException(500, f"Render failed: {e}")
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result



def _load_graph(graph_id: str):
    try:
        graph = graph_service.get_graph(graph_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not graph:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return graph
