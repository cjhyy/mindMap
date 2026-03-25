"""Node CRUD and detail endpoints."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import PROJECT_DIR
from app.schemas import NodeDetail, NodeConnection, NodeDocResponse, NodeDocUpdate, NodeListItem, NodeUpdate
from app.services.graph_service import graph_service

sys.path.insert(0, str(PROJECT_DIR))

from tools.models import EdgeType, KnowledgeGraph, NodeStatus

router = APIRouter(prefix="/api/graphs/{graph_id}/nodes", tags=["nodes"])


@router.get("", response_model=list[NodeListItem])
async def list_nodes(
    graph_id: str,
    keyword: str = "",
    domain: str = "",
    status: str = "",
):
    """List all nodes in a graph, with optional filters."""
    g = _load_graph(graph_id)

    nodes = list(g.nodes.values())

    if keyword:
        kw = keyword.lower()
        nodes = [n for n in nodes if kw in n.label.lower() or kw in n.description.lower()]
    if domain:
        d = domain.lower()
        nodes = [n for n in nodes if d in n.domain.lower()]
    if status:
        valid_statuses = {"unexplored", "explored", "expanded"}
        if status not in valid_statuses:
            raise HTTPException(400, f"Invalid status: '{status}'. Use: {', '.join(valid_statuses)}")
        nodes = [n for n in nodes if n.status.value == status]

    return [
        NodeListItem(
            id=n.id, label=n.label, domain=n.domain, level=n.level,
            status=n.status.value, parent_id=n.parent_id,
            children_count=len(g.get_children(n.id)),
            description=n.description,
        )
        for n in sorted(nodes, key=lambda n: (n.level, n.label))
    ]


@router.get("/{node_id}", response_model=NodeDetail)
async def get_node(graph_id: str, node_id: str):
    """Get a node's full details including children and cross-connections."""
    g = _load_graph(graph_id)
    node = g.nodes.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    children = [
        {"id": c.id, "label": c.label, "status": c.status.value, "domain": c.domain}
        for c in g.get_children(node_id)
    ]

    connections = []
    for edge, other in g.get_non_tree_connections(node_id):
        connections.append(NodeConnection(
            edge_id=edge.id,
            node_id=other.id,
            label=other.label,
            edge_type=edge.edge_type.value,
            edge_label=edge.label,
        ))

    doc_url = f"/api/graphs/{graph_id}/nodes/{node_id}/doc" if node.has_doc else None

    return NodeDetail(
        id=node.id, label=node.label, description=node.description,
        domain=node.domain, level=node.level, status=node.status.value,
        tags=node.tags, source_urls=node.source_urls,
        parent_id=node.parent_id,
        created_at=node.created_at, updated_at=node.updated_at,
        children=children, cross_connections=connections,
        has_doc=node.has_doc, content_depth=node.content_depth.value,
        doc_summary=node.doc_summary, doc_sections=node.doc_sections,
        doc_url=doc_url,
    )


@router.patch("/{node_id}", response_model=NodeDetail)
async def update_node(graph_id: str, node_id: str, req: NodeUpdate):
    """Update a node's fields. Only provided fields are changed."""
    g = _load_graph(graph_id)
    node = g.nodes.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    if req.label is not None:
        node.label = req.label
    if req.description is not None:
        node.description = req.description
    if req.domain is not None:
        node.domain = req.domain
    if req.tags is not None:
        node.tags = req.tags
    if req.source_urls is not None:
        node.source_urls = req.source_urls
    if req.status is not None:
        try:
            node.status = NodeStatus(req.status)
        except ValueError:
            raise HTTPException(400, f"Invalid status: '{req.status}'")

    from tools.models import _now_iso
    node.updated_at = _now_iso()

    # Save graph back to file
    path = graph_service.get_graph_path(graph_id)
    g.save(path)
    graph_service.update_meta_from_graph(graph_id)

    # Return updated node detail
    return await get_node(graph_id, node_id)


# ── Document endpoints ───────────────────────────────────────


@router.get("/{node_id}/doc", response_model=NodeDocResponse)
async def get_node_doc(graph_id: str, node_id: str):
    """Get the full Markdown document for a node."""
    g = _load_graph(graph_id)
    node = g.nodes.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")
    if not node.has_doc:
        raise HTTPException(404, f"Node '{node.label}' has no document")

    doc_path = graph_service.get_node_doc_path(graph_id, node_id)
    if not doc_path.exists():
        raise HTTPException(404, f"Document file not found for '{node.label}'")

    content = doc_path.read_text(encoding="utf-8")
    return NodeDocResponse(
        node_id=node_id, label=node.label,
        content=content, sections=node.doc_sections,
    )


@router.put("/{node_id}/doc", response_model=NodeDocResponse)
async def update_node_doc(graph_id: str, node_id: str, req: NodeDocUpdate):
    """Update (or create) a node's Markdown document."""
    g = _load_graph(graph_id)
    node = g.nodes.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    doc_path = graph_service.get_node_doc_path(graph_id, node_id)
    doc_path.write_text(req.content, encoding="utf-8")

    # Update node metadata
    from tools.models import ContentDepth, _now_iso
    node.has_doc = True
    node.content_depth = ContentDepth.DEEP

    lines = req.content.split("\n")
    node.doc_sections = [line.lstrip("#").strip() for line in lines if line.startswith("## ")]

    # Extract summary
    summary_lines = []
    in_fm = False
    for line in lines:
        if line.strip() == "---":
            in_fm = not in_fm
            continue
        if in_fm or line.startswith("#") or line.startswith(">") or not line.strip():
            continue
        summary_lines.append(line.strip())
        if len(" ".join(summary_lines)) > 200:
            break
    node.doc_summary = " ".join(summary_lines)[:200]
    node.updated_at = _now_iso()

    path = graph_service.get_graph_path(graph_id)
    g.save(path)
    graph_service.update_meta_from_graph(graph_id)

    return NodeDocResponse(
        node_id=node_id, label=node.label,
        content=req.content, sections=node.doc_sections,
    )


@router.delete("/{node_id}/doc")
async def delete_node_doc(graph_id: str, node_id: str):
    """Delete a node's document."""
    g = _load_graph(graph_id)
    node = g.nodes.get(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    doc_path = graph_service.get_node_doc_path(graph_id, node_id)
    if doc_path.exists():
        doc_path.unlink()

    from tools.models import ContentDepth, _now_iso
    node.has_doc = False
    node.content_depth = ContentDepth.SHALLOW
    node.doc_summary = ""
    node.doc_sections = []
    node.updated_at = _now_iso()

    path = graph_service.get_graph_path(graph_id)
    g.save(path)
    graph_service.update_meta_from_graph(graph_id)

    return {"status": "deleted", "node_id": node_id}


def _load_graph(graph_id: str) -> KnowledgeGraph:
    try:
        g = graph_service.get_graph(graph_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return g
