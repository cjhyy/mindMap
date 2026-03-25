"""Node CRUD and detail endpoints."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import PROJECT_DIR
from app.schemas import NodeDetail, NodeConnection, NodeListItem, NodeUpdate
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

    return NodeDetail(
        id=node.id, label=node.label, description=node.description,
        domain=node.domain, level=node.level, status=node.status.value,
        tags=node.tags, source_urls=node.source_urls,
        parent_id=node.parent_id,
        created_at=node.created_at, updated_at=node.updated_at,
        children=children, cross_connections=connections,
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


def _load_graph(graph_id: str) -> KnowledgeGraph:
    g = graph_service.get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return g
