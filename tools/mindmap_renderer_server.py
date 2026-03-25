"""MCP tool server for knowledge graph visualization."""

from __future__ import annotations

import json
from pathlib import Path

from fastmcp import FastMCP

from tools.models import EdgeType, KnowledgeGraph, NodeStatus

mcp = FastMCP("mindmap-renderer")

_graph_path: Path = Path(__file__).parent.parent / "data" / "knowledge_graph.json"


def set_graph_path(path: Path | str) -> None:
    """Set the graph file path for rendering."""
    global _graph_path
    _graph_path = Path(path)


_MAX_DEPTH = 20


def _clamp_depth(d: int) -> int:
    return max(0, min(d, _MAX_DEPTH))


def _load_graph() -> KnowledgeGraph | None:
    if _graph_path.exists():
        return KnowledgeGraph.load(_graph_path)
    return None


def _ok(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False)


def _err(msg: str) -> str:
    return json.dumps({"error": msg}, ensure_ascii=False)


def _sanitize_mermaid(text: str) -> str:
    """Escape characters that break Mermaid syntax."""
    return text.replace('"', "'").replace("(", "（").replace(")", "）")


# ── Tool: render_mermaid ────────────────────────────────────────


@mcp.tool()
async def render_mermaid(node_id: str = "", max_depth: int = 3) -> str:
    """Render the knowledge graph as a Mermaid mindmap diagram.

    Shows the tree structure. Use render_mermaid_graph for cross-connections.

    Args:
        node_id: Root node to start from (empty = graph root)
        max_depth: Maximum depth to render (default 3)

    Returns:
        Mermaid mindmap syntax string
    """
    max_depth = _clamp_depth(max_depth)
    g = _load_graph()
    if not g or not g.nodes:
        return _err("No knowledge graph exists yet")

    root_id = node_id or g.root_node_id
    if not root_id or root_id not in g.nodes:
        return _err(f"Node '{root_id}' not found")

    lines = ["mindmap"]

    def render_node(nid: str, depth: int, indent: int) -> None:
        node = g.nodes.get(nid)
        if not node:
            return
        label = _sanitize_mermaid(node.label)
        prefix = "  " * indent

        # Root uses double-circle, others use plain
        if depth == 0:
            lines.append(f"{prefix}root(({label}))")
        else:
            status_mark = ""
            if node.status == NodeStatus.EXPANDED:
                status_mark = " ✓"
            elif node.status == NodeStatus.UNEXPLORED:
                status_mark = " ?"
            lines.append(f"{prefix}{label}{status_mark}")

        if depth < max_depth:
            for child in g.get_children(nid):
                render_node(child.id, depth + 1, indent + 1)

    render_node(root_id, 0, 1)

    mermaid_text = "\n".join(lines)
    return _ok({"format": "mermaid_mindmap", "content": mermaid_text})


# ── Tool: render_mermaid_graph ──────────────────────────────────


@mcp.tool()
async def render_mermaid_graph(node_id: str = "") -> str:
    """Render the knowledge graph as a Mermaid flowchart showing cross-connections.

    Parent-child edges are solid arrows, cross-domain edges are dashed.

    Args:
        node_id: Focus node (empty = show entire graph)

    Returns:
        Mermaid flowchart syntax string
    """
    g = _load_graph()
    if not g or not g.nodes:
        return _err("No knowledge graph exists yet")

    lines = ["graph LR"]

    # Determine which nodes to include
    if node_id and node_id in g.nodes:
        # Show the node, its children, and all cross-connected nodes
        include_ids = set(g.get_subtree_ids(node_id, max_depth=2))
        for edge, other in g.get_non_tree_connections(node_id):
            include_ids.add(other.id)
    else:
        include_ids = set(g.nodes.keys())

    # Node definitions with styling
    domain_styles: dict[str, str] = {}
    colors = ["#4ECDC4", "#FF6B6B", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"]
    for node in g.nodes.values():
        if node.id not in include_ids:
            continue
        label = _sanitize_mermaid(node.label)
        lines.append(f'    {node.id}["{label}"]')
        if node.domain and node.domain not in domain_styles:
            domain_styles[node.domain] = colors[len(domain_styles) % len(colors)]

    # Edges
    for edge in g.edges.values():
        if edge.source_id not in include_ids or edge.target_id not in include_ids:
            continue
        if edge.edge_type == EdgeType.PARENT_CHILD:
            lines.append(f"    {edge.source_id} --> {edge.target_id}")
        else:
            edge_label = edge.label or edge.edge_type.value
            lines.append(f'    {edge.source_id} -."{edge_label}".- {edge.target_id}')

    # Style nodes by domain
    for node in g.nodes.values():
        if node.id not in include_ids:
            continue
        if node.domain in domain_styles:
            color = domain_styles[node.domain]
            lines.append(f"    style {node.id} fill:{color},stroke:#333")

    mermaid_text = "\n".join(lines)
    return _ok({"format": "mermaid_flowchart", "content": mermaid_text})


# ── Tool: render_markdown_outline ───────────────────────────────


@mcp.tool()
async def render_markdown_outline(node_id: str = "", max_depth: int = 4) -> str:
    """Render the knowledge graph as a Markdown nested outline.

    Shows tree structure with status icons and cross-connections section.

    Args:
        node_id: Root node to start from (empty = graph root)
        max_depth: Maximum depth to render (default 4)

    Returns:
        Markdown formatted outline
    """
    max_depth = _clamp_depth(max_depth)
    g = _load_graph()
    if not g or not g.nodes:
        return _err("No knowledge graph exists yet")

    root_id = node_id or g.root_node_id
    if not root_id or root_id not in g.nodes:
        return _err(f"Node '{root_id}' not found")

    lines = []

    def status_icon(s: NodeStatus) -> str:
        if s == NodeStatus.EXPANDED:
            return "[x]"
        elif s == NodeStatus.EXPLORED:
            return "[-]"
        else:
            return "[ ]"

    def render_node(nid: str, depth: int) -> None:
        node = g.nodes.get(nid)
        if not node:
            return
        indent = "  " * depth
        icon = status_icon(node.status)
        domain_tag = f" `{node.domain}`" if node.domain and depth <= 1 else ""
        lines.append(f"{indent}- {icon} **{node.label}**{domain_tag}")
        if node.description and depth <= 2:
            lines.append(f"{indent}  _{node.description}_")

        if depth < max_depth:
            for child in g.get_children(nid):
                render_node(child.id, depth + 1)

    root_node = g.nodes[root_id]
    lines.append(f"# {root_node.label}")
    lines.append("")

    for child in g.get_children(root_id):
        render_node(child.id, 0)

    # Cross-connections section
    cross_edges = [e for e in g.edges.values() if e.edge_type != EdgeType.PARENT_CHILD]
    if cross_edges:
        lines.append("")
        lines.append("## Cross-Connections")
        for e in cross_edges:
            src = g.nodes.get(e.source_id)
            tgt = g.nodes.get(e.target_id)
            if src and tgt:
                label = e.label or e.edge_type.value
                lines.append(f"- **{src.label}** --[{label}]--> **{tgt.label}**")

    md_text = "\n".join(lines)
    return _ok({"format": "markdown_outline", "content": md_text})


# ── Tool: render_node_detail ────────────────────────────────────


@mcp.tool()
async def render_node_detail(node_id: str) -> str:
    """Show detailed information about a single node.

    Includes description, status, tags, connections, and source URLs.

    Args:
        node_id: ID of the node to display

    Returns:
        Formatted Markdown detail view
    """
    g = _load_graph()
    if not g:
        return _err("No knowledge graph exists yet")

    node = g.nodes.get(node_id)
    if not node:
        return _err(f"Node '{node_id}' not found")

    lines = [
        f"## {node.label}",
        f"**Domain**: {node.domain}",
        f"**Status**: {node.status.value}",
        f"**Level**: {node.level}",
    ]

    if node.description:
        lines.append(f"\n{node.description}")

    if node.tags:
        lines.append(f"\n**Tags**: {', '.join(node.tags)}")

    # Parent
    parent = g.get_parent(node_id)
    if parent:
        lines.append(f"\n**Parent**: {parent.label} (`{parent.id}`)")

    # Children
    children = g.get_children(node_id)
    if children:
        lines.append(f"\n**Children** ({len(children)}):")
        for c in children:
            lines.append(f"  - {c.label} ({c.status.value}) `{c.id}`")

    # Cross-connections
    cross = g.get_non_tree_connections(node_id)
    if cross:
        lines.append(f"\n**Cross-Connections** ({len(cross)}):")
        for edge, other in cross:
            label = edge.label or edge.edge_type.value
            lines.append(f"  - --[{label}]--> {other.label} `{other.id}`")

    # Sources
    if node.source_urls:
        lines.append("\n**Sources**:")
        for url in node.source_urls:
            lines.append(f"  - {url}")

    md = "\n".join(lines)
    return _ok({"format": "markdown_detail", "content": md})


if __name__ == "__main__":
    mcp.run(transport="stdio", show_banner=False)
