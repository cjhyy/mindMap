"""MCP tool server for knowledge graph CRUD operations."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastmcp import FastMCP

from backend.tools.models import (
    ContentDepth,
    EdgeType,
    KnowledgeEdge,
    KnowledgeGraph,
    KnowledgeNode,
    NodeStatus,
    _now_iso,
)

mcp = FastMCP("mindmap-manager")

_graph: KnowledgeGraph | None = None
_graph_path: Path = Path(__file__).parent.parent / "data" / "knowledge_graph.json"
_graph_lock = asyncio.Lock()


def set_graph_path(path: Path | str) -> None:
    """Set the graph file path and reset the cached graph."""
    global _graph_path, _graph
    _graph_path = Path(path)
    _graph = None


def reset_graph() -> None:
    """Reset the cached graph (forces reload from disk on next access)."""
    global _graph
    _graph = None


def _get_graph() -> KnowledgeGraph:
    global _graph
    if _graph is None:
        if _graph_path.exists():
            _graph = KnowledgeGraph.load(_graph_path)
        else:
            _graph = KnowledgeGraph()
    return _graph


def _save() -> None:
    _get_graph().save(_graph_path)


async def _locked_mutation(fn):
    """Execute a graph mutation under lock to prevent concurrent corruption."""
    async with _graph_lock:
        return fn()


def _ok(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False)




def _err(msg: str) -> str:
    return json.dumps({"error": msg}, ensure_ascii=False)


# ── Tool: create_mindmap ────────────────────────────────────────


@mcp.tool()
async def create_mindmap(name: str, description: str, root_label: str) -> str:
    """Create a new knowledge mindmap with a root node.

    Call this first before adding any nodes. Overwrites any existing graph.

    Args:
        name: Name of the knowledge map, e.g. "AI Agent Development"
        description: Brief description of the learning goal
        root_label: Label for the root node, e.g. "AI Agent Development"

    Returns:
        JSON with root_node_id and graph name
    """
    async with _graph_lock:
        global _graph
        _graph = KnowledgeGraph(name=name, description=description)

        root = KnowledgeNode(
            label=root_label,
            description=description,
            domain=root_label,
            level=0,
            status=NodeStatus.EXPLORED,
        )
        _graph.nodes[root.id] = root
        _graph.root_node_id = root.id
        _save()

    return _ok({
        "status": "created",
        "graph_name": name,
        "root_node_id": root.id,
        "root_label": root_label,
    })


# ── Tool: add_node ──────────────────────────────────────────────


@mcp.tool()
async def add_node(
    label: str,
    description: str,
    parent_id: str,
    domain: str = "",
    tags: str = "",
) -> str:
    """Add a single knowledge node as a child of an existing node.

    Args:
        label: Short name for the node (2-5 words), e.g. "Prompt Engineering"
        description: 1-2 sentence description of this knowledge point
        parent_id: ID of the parent node
        domain: Top-level domain category, e.g. "LLM", "Python"
        tags: Comma-separated tags for cross-connection matching

    Returns:
        JSON with the new node ID
    """
    async with _graph_lock:
        g = _get_graph()
        if parent_id not in g.nodes:
            return _err(f"Parent node '{parent_id}' not found")

        # Check exact duplicate label under same parent
        for c in g.get_children(parent_id):
            if c.label == label:
                return _err(f"Node '{label}' already exists under this parent (id={c.id})")

        parent = g.nodes[parent_id]
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

        node = KnowledgeNode(
            label=label,
            description=description,
            domain=domain or parent.domain,
            level=parent.level + 1,
            tags=tag_list,
            parent_id=parent_id,
        )
        g.nodes[node.id] = node

        edge = KnowledgeEdge(
            source_id=parent_id,
            target_id=node.id,
            edge_type=EdgeType.PARENT_CHILD,
            label="contains",
        )
        g.edges[edge.id] = edge

        # Auto-promote parent status
        if parent.status == NodeStatus.UNEXPLORED:
            parent.status = NodeStatus.EXPLORED
            parent.updated_at = _now_iso()

        _save()

    return _ok({"status": "added", "node_id": node.id, "label": label, "parent_id": parent_id})


# ── Tool: add_nodes_batch ───────────────────────────────────────


@mcp.tool()
async def add_nodes_batch(nodes_json: str) -> str:
    """Add multiple knowledge nodes at once (max 8 per call).

    Each parent node can have at most 8 children total. Excess nodes will be skipped.

    Args:
        nodes_json: JSON array of objects, each with: label (required), description (required),
                     parent_id (required), domain (optional), tags (optional, comma-separated string)

    Returns:
        JSON with list of created node IDs
    """
    try:
        nodes_data = json.loads(nodes_json)
    except json.JSONDecodeError as e:
        return _err(f"Invalid JSON: {e}")

    if not isinstance(nodes_data, list):
        return _err("nodes_json must be a JSON array")

    async with _graph_lock:
        g = _get_graph()
        created = []
        skipped = []
        batch_labels: dict[str, list[str]] = {}  # parent_id -> labels added in this batch

        for item in nodes_data:
            label = item.get("label", "")
            description = item.get("description", "")
            parent_id = item.get("parent_id", "")

            if not label or not parent_id:
                skipped.append(f"Missing label or parent_id: {label}")
                continue

            if parent_id not in g.nodes:
                skipped.append(f"Parent not found: {label}")
                continue

            # Check exact duplicate under same parent
            existing_labels = {c.label for c in g.get_children(parent_id)}
            if label in existing_labels:
                skipped.append(f"Already exists: {label}")
                continue

            # Check exact duplicate within this batch
            if label in batch_labels.get(parent_id, []):
                skipped.append(f"Duplicate in batch: {label}")
                continue

            parent = g.nodes[parent_id]
            tags_raw = item.get("tags", "")
            tag_list = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []

            node = KnowledgeNode(
                label=label,
                description=description,
                domain=item.get("domain", "") or parent.domain,
                level=parent.level + 1,
                tags=tag_list,
                parent_id=parent_id,
            )
            g.nodes[node.id] = node

            edge = KnowledgeEdge(
                source_id=parent_id,
                target_id=node.id,
                edge_type=EdgeType.PARENT_CHILD,
                label="contains",
            )
            g.edges[edge.id] = edge
            created.append({"node_id": node.id, "label": label})
            batch_labels.setdefault(parent_id, []).append(label)

        # Auto-promote parent status: unexplored → explored when children are added
        promoted = []
        for pid in batch_labels:
            parent = g.nodes.get(pid)
            if parent and parent.status == NodeStatus.UNEXPLORED:
                parent.status = NodeStatus.EXPLORED
                parent.updated_at = _now_iso()
                promoted.append(pid)

        _save()

    result = {"status": "batch_added", "created": len(created), "nodes": created}
    if skipped:
        result["skipped"] = skipped
    return _ok(result)


# ── Tool: update_node ───────────────────────────────────────────


@mcp.tool()
async def update_node(
    node_id: str,
    description: str = "",
    status: str = "",
    tags: str = "",
) -> str:
    """Update an existing node's description, status, or tags.

    Args:
        node_id: ID of the node to update
        description: New description (leave empty to keep current)
        status: New status: "unexplored", "explored", or "expanded" (leave empty to keep current)
        tags: New comma-separated tags (leave empty to keep current)

    Returns:
        Success or error message
    """
    async with _graph_lock:
        g = _get_graph()
        node = g.nodes.get(node_id)
        if not node:
            return _err(f"Node '{node_id}' not found")

        if description:
            node.description = description
        if status:
            try:
                node.status = NodeStatus(status)
            except ValueError:
                return _err(f"Invalid status: '{status}'. Use unexplored/explored/expanded")
        if tags:
            node.tags = [t.strip() for t in tags.split(",") if t.strip()]

        node.updated_at = _now_iso()
        _save()
    return _ok({"status": "updated", "node_id": node_id, "label": node.label})


# ── Tool: add_edge ──────────────────────────────────────────────


@mcp.tool()
async def add_edge(
    source_id: str,
    target_id: str,
    edge_type: str = "related",
    label: str = "",
) -> str:
    """Add a cross-reference edge between two existing nodes.

    Use this to create knowledge connections beyond the parent-child tree.

    Args:
        source_id: Source node ID
        target_id: Target node ID
        edge_type: One of: "cross_domain", "prerequisite", "related"
        label: Optional label describing the relationship, e.g. "requires", "enhances"

    Returns:
        JSON with edge ID
    """
    async with _graph_lock:
        g = _get_graph()
        if source_id not in g.nodes:
            return _err(f"Source node '{source_id}' not found")
        if target_id not in g.nodes:
            return _err(f"Target node '{target_id}' not found")

        # Check for duplicate edge
        for e in g.edges.values():
            if (
                (e.source_id == source_id and e.target_id == target_id)
                or (e.source_id == target_id and e.target_id == source_id)
            ) and e.edge_type != EdgeType.PARENT_CHILD:
                return _ok({
                    "status": "already_exists",
                    "edge_id": e.id,
                    "message": "Edge already exists between these nodes",
                })

        try:
            et = EdgeType(edge_type)
        except ValueError:
            return _err(f"Invalid edge_type: '{edge_type}'. Use cross_domain/prerequisite/related")

        edge = KnowledgeEdge(
            source_id=source_id,
            target_id=target_id,
            edge_type=et,
            label=label,
        )
        g.edges[edge.id] = edge
        _save()

        src_label = g.nodes[source_id].label
        tgt_label = g.nodes[target_id].label
    return _ok({
        "status": "edge_added",
        "edge_id": edge.id,
        "from": src_label,
        "to": tgt_label,
        "type": edge_type,
    })


# ── Tool: delete_node ───────────────────────────────────────────


@mcp.tool()
async def delete_node(node_id: str) -> str:
    """Delete a node and ALL its descendants (entire subtree).

    Args:
        node_id: ID of the node to delete (the node and all children/grandchildren will be removed)

    Returns:
        Success or error message
    """
    async with _graph_lock:
        g = _get_graph()
        if node_id not in g.nodes:
            return _err(f"Node '{node_id}' not found")

        if node_id == g.root_node_id:
            return _err("Cannot delete the root node")

        label = g.nodes[node_id].label

        # Collect entire subtree via BFS
        subtree_ids = set(g.get_subtree_ids(node_id))
        subtree_ids.add(node_id)

        # Remove all edges touching any subtree node
        edges_to_remove = [
            eid for eid, e in g.edges.items()
            if e.source_id in subtree_ids or e.target_id in subtree_ids
        ]
        for eid in edges_to_remove:
            del g.edges[eid]

        # Remove all subtree nodes
        for nid in subtree_ids:
            g.nodes.pop(nid, None)

        _save()

    return _ok({"status": "deleted", "label": label, "deleted_count": len(subtree_ids)})


# ── Tool: get_node ──────────────────────────────────────────────


@mcp.tool()
async def get_node(node_id: str) -> str:
    """Get a node's full details including its children and cross-connections.

    Args:
        node_id: ID of the node to retrieve

    Returns:
        JSON with node data, children list, and connections
    """
    g = _get_graph()
    node = g.nodes.get(node_id)
    if not node:
        return _err(f"Node '{node_id}' not found")

    children = [
        {"id": c.id, "label": c.label, "status": c.status.value}
        for c in g.get_children(node_id)
    ]

    connections = []
    for edge, other in g.get_non_tree_connections(node_id):
        connections.append({
            "edge_id": edge.id,
            "node_id": other.id,
            "label": other.label,
            "edge_type": edge.edge_type.value,
            "edge_label": edge.label,
        })

    return _ok({
        "node": node.to_dict(),
        "children": children,
        "cross_connections": connections,
    })


# ── Tool: get_subtree ──────────────────────────────────────────


@mcp.tool()
async def get_subtree(node_id: str, max_depth: int = 2) -> str:
    """Get a subtree rooted at the given node.

    Args:
        node_id: Root node ID for the subtree
        max_depth: Maximum depth to traverse (default 2)

    Returns:
        JSON tree structure with nested children
    """
    max_depth = max(0, min(max_depth, 20))
    g = _get_graph()
    if node_id not in g.nodes:
        return _err(f"Node '{node_id}' not found")

    def build_tree(nid: str, depth: int) -> dict:
        node = g.nodes[nid]
        result = {
            "id": node.id,
            "label": node.label,
            "status": node.status.value,
            "domain": node.domain,
        }
        if depth < max_depth:
            children = g.get_children(nid)
            if children:
                result["children"] = [build_tree(c.id, depth + 1) for c in children]
        return result

    tree = build_tree(node_id, 0)
    return _ok({"subtree": tree})


# ── Tool: query_graph ───────────────────────────────────────────


@mcp.tool()
async def query_graph(
    keyword: str = "",
    domain: str = "",
    status: str = "",
) -> str:
    """Search and filter nodes in the knowledge graph.

    All filters are combined with AND logic. Provide at least one filter.

    Args:
        keyword: Search in node labels (case-insensitive partial match)
        domain: Filter by domain (case-insensitive partial match)
        status: Filter by status: "unexplored", "explored", or "expanded"

    Returns:
        JSON list of matching nodes
    """
    g = _get_graph()
    results = list(g.nodes.values())

    if keyword:
        kw = keyword.lower()
        results = [n for n in results if kw in n.label.lower() or kw in n.description.lower()]

    if domain:
        d = domain.lower()
        results = [n for n in results if d in n.domain.lower()]

    if status:
        try:
            s = NodeStatus(status)
            results = [n for n in results if n.status == s]
        except ValueError:
            return _err(f"Invalid status: '{status}'")

    return _ok({
        "count": len(results),
        "nodes": [
            {
                "id": n.id,
                "label": n.label,
                "domain": n.domain,
                "status": n.status.value,
                "level": n.level,
                "parent_id": n.parent_id,
            }
            for n in results[:50]  # Limit to prevent context overflow
        ],
    })


# ── Tool: get_graph_summary ────────────────────────────────────


@mcp.tool()
async def get_graph_summary() -> str:
    """Get an overview of the entire knowledge graph.

    Returns node count, edge count, domain list, unexplored count,
    and the top-level tree structure.

    Returns:
        JSON summary of the graph
    """
    g = _get_graph()

    if not g.nodes:
        return _ok({
            "status": "empty",
            "message": "No knowledge graph exists yet. Use create_mindmap to start.",
        })

    # Top-level structure (children of root)
    top_level = []
    if g.root_node_id:
        for child in g.get_children(g.root_node_id):
            sub_children = g.get_children(child.id)
            top_level.append({
                "id": child.id,
                "label": child.label,
                "status": child.status.value,
                "children_count": len(sub_children),
            })

    cross_edges = [e for e in g.edges.values() if e.edge_type != EdgeType.PARENT_CHILD]

    return _ok({
        "graph_name": g.name,
        "total_nodes": len(g.nodes),
        "total_edges": len(g.edges),
        "cross_connections": len(cross_edges),
        "domains": g.get_domains(),
        "unexplored_count": len(g.get_unexplored_nodes()),
        "root_node_id": g.root_node_id,
        "root_label": g.nodes[g.root_node_id].label if g.root_node_id else None,
        "top_level_structure": top_level,
    })


# ── Tool: find_cross_connections ────────────────────────────────


@mcp.tool()
async def find_cross_connections(node_id: str) -> str:
    """Find potential cross-domain connections for a node.

    Analyzes the node's tags, label, and domain to find related nodes
    in other parts of the knowledge graph. Returns suggested connections
    that you can then create using add_edge.

    Args:
        node_id: The node to find connections for

    Returns:
        JSON list of potential connections with match reasons
    """
    g = _get_graph()
    node = g.nodes.get(node_id)
    if not node:
        return _err(f"Node '{node_id}' not found")

    # Collect existing connections to skip
    existing_connected = {node_id}
    if node.parent_id:
        existing_connected.add(node.parent_id)
    for e in g.edges.values():
        if e.source_id == node_id:
            existing_connected.add(e.target_id)
        elif e.target_id == node_id:
            existing_connected.add(e.source_id)
    # Also skip direct children
    for child in g.get_children(node_id):
        existing_connected.add(child.id)

    # Build keyword set from label + tags
    node_words = set()
    for word in node.label.lower().split():
        if len(word) > 1:
            node_words.add(word)
    for tag in node.tags:
        node_words.add(tag.lower())

    candidates = []
    for other in g.nodes.values():
        if other.id in existing_connected:
            continue

        other_words = set()
        for word in other.label.lower().split():
            if len(word) > 1:
                other_words.add(word)
        for tag in other.tags:
            other_words.add(tag.lower())

        overlap = node_words & other_words
        # Also check if node label appears in other's description or vice versa
        label_in_desc = (
            node.label.lower() in other.description.lower()
            or other.label.lower() in node.description.lower()
        )

        score = len(overlap)
        reasons = []
        if overlap:
            reasons.append(f"Shared concepts: {', '.join(sorted(overlap))}")
        if label_in_desc:
            score += 2
            reasons.append("Referenced in description")
        if node.domain and other.domain and node.domain != other.domain:
            score += 1  # Cross-domain bonus
            reasons.append(f"Cross-domain: {node.domain} ↔ {other.domain}")

        if score > 0:
            candidates.append({
                "node_id": other.id,
                "label": other.label,
                "domain": other.domain,
                "score": score,
                "reasons": reasons,
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return _ok({
        "node_label": node.label,
        "potential_connections": candidates[:10],
    })


# ── Tool: assess_node_depth ─────────────────────────────────


@mcp.tool()
async def assess_node_depth(node_id: str) -> str:
    """Assess whether a knowledge node is deep enough to warrant an independent document.

    Evaluates the node's topic complexity and returns a recommended content depth:
    - shallow: Simple concept, one-sentence description is enough
    - medium: Has some depth, needs a few paragraphs
    - deep: Complex topic with sub-concepts, code examples, best practices — needs a full MD article

    Args:
        node_id: The node to assess

    Returns:
        JSON with current depth, recommended depth, and reasoning
    """
    g = _get_graph()
    node = g.nodes.get(node_id)
    if not node:
        return _err(f"Node '{node_id}' not found")

    children = g.get_children(node_id)
    connections = g.get_non_tree_connections(node_id)

    # Heuristic scoring
    score = 0
    reasons = []

    if len(children) >= 3:
        score += 2
        reasons.append(f"Has {len(children)} sub-topics")
    if len(connections) >= 2:
        score += 1
        reasons.append(f"Has {len(connections)} cross-connections")
    if node.level <= 2:
        score += 1
        reasons.append("High-level topic (level {})".format(node.level))
    if any(kw in node.label.lower() for kw in ["工程", "技术", "框架", "模式", "architecture", "engineering", "pattern"]):
        score += 1
        reasons.append("Technical/engineering topic")
    if node.tags and len(node.tags) >= 3:
        score += 1
        reasons.append(f"Rich tagging ({len(node.tags)} tags)")

    if score >= 4:
        recommended = "deep"
    elif score >= 2:
        recommended = "medium"
    else:
        recommended = "shallow"

    return _ok({
        "node_id": node_id,
        "label": node.label,
        "current_depth": node.content_depth.value,
        "recommended_depth": recommended,
        "score": score,
        "reasons": reasons,
    })


# ── Tool: generate_node_doc ────────────────────────────────


@mcp.tool()
async def generate_node_doc(node_id: str, content: str) -> str:
    """Save a comprehensive Markdown document for a knowledge node.

    The content should be a well-structured article covering:
    - Overview / definition
    - Core concepts and principles
    - Code examples (if applicable)
    - Practical tips and best practices
    - Related knowledge points
    - References and resources

    Use YAML frontmatter format at the top of the document.

    Args:
        node_id: The node to create documentation for
        content: Full Markdown content of the document

    Returns:
        JSON with save status, doc path, and summary
    """

    async with _graph_lock:
        g = _get_graph()
        node = g.nodes.get(node_id)
        if not node:
            return _err(f"Node '{node_id}' not found")

        # Save document to docs/ directory
        docs_dir = _graph_path.parent / "docs"
        docs_dir.mkdir(parents=True, exist_ok=True)
        doc_path = docs_dir / f"{node_id}.md"
        doc_path.write_text(content, encoding="utf-8")

        # Update node metadata
        node.has_doc = True
        node.content_depth = ContentDepth.DEEP
        if node.status in (NodeStatus.UNEXPLORED, NodeStatus.EXPLORED):
            node.status = NodeStatus.EXPANDED
        node.updated_at = _now_iso()

        # Extract summary (first non-frontmatter, non-heading paragraph)
        lines = content.split("\n")
        summary_lines = []
        in_frontmatter = False
        for line in lines:
            if line.strip() == "---":
                in_frontmatter = not in_frontmatter
                continue
            if in_frontmatter:
                continue
            if line.startswith("#") or line.startswith(">") or not line.strip():
                continue
            summary_lines.append(line.strip())
            if len(" ".join(summary_lines)) > 200:
                break
        node.doc_summary = " ".join(summary_lines)[:200]

        # Extract section headings
        sections = [line.lstrip("#").strip() for line in lines if line.startswith("## ")]
        node.doc_sections = sections

        node.updated_at = _now_iso()
        _save()

    return _ok({
        "status": "doc_saved",
        "node_id": node_id,
        "label": node.label,
        "doc_path": str(doc_path),
        "sections": sections,
        "summary": node.doc_summary,
    })


# ── Tool: get_node_doc ─────────────────────────────────────


@mcp.tool()
async def get_node_doc(node_id: str) -> str:
    """Read the full Markdown document for a knowledge node.

    Args:
        node_id: The node whose document to read

    Returns:
        JSON with the document content, or error if no document exists
    """
    g = _get_graph()
    node = g.nodes.get(node_id)
    if not node:
        return _err(f"Node '{node_id}' not found")

    if not node.has_doc:
        return _err(f"Node '{node.label}' has no document. Use generate_node_doc to create one.")

    doc_path = _graph_path.parent / "docs" / f"{node_id}.md"
    if not doc_path.exists():
        return _err(f"Document file not found for '{node.label}'")

    content = doc_path.read_text(encoding="utf-8")
    return _ok({
        "node_id": node_id,
        "label": node.label,
        "content": content,
        "sections": node.doc_sections,
    })


# ── Tool: update_node_doc ──────────────────────────────────


@mcp.tool()
async def update_node_doc(node_id: str, content: str) -> str:
    """Update an existing document for a knowledge node.

    Args:
        node_id: The node whose document to update
        content: New full Markdown content

    Returns:
        JSON with update status
    """

    async with _graph_lock:
        g = _get_graph()
        node = g.nodes.get(node_id)
        if not node:
            return _err(f"Node '{node_id}' not found")

        doc_path = _graph_path.parent / "docs" / f"{node_id}.md"
        doc_path.parent.mkdir(parents=True, exist_ok=True)
        doc_path.write_text(content, encoding="utf-8")

        node.has_doc = True
        node.content_depth = ContentDepth.DEEP

        # Re-extract summary and sections
        lines = content.split("\n")
        summary_lines = []
        in_frontmatter = False
        for line in lines:
            if line.strip() == "---":
                in_frontmatter = not in_frontmatter
                continue
            if in_frontmatter:
                continue
            if line.startswith("#") or line.startswith(">") or not line.strip():
                continue
            summary_lines.append(line.strip())
            if len(" ".join(summary_lines)) > 200:
                break
        node.doc_summary = " ".join(summary_lines)[:200]
        node.doc_sections = [line.lstrip("#").strip() for line in lines if line.startswith("## ")]

        node.updated_at = _now_iso()
        _save()

    return _ok({
        "status": "doc_updated",
        "node_id": node_id,
        "label": node.label,
        "sections": node.doc_sections,
    })


if __name__ == "__main__":
    mcp.run(transport="stdio", show_banner=False)
