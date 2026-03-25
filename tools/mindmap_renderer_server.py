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


# ── Tool: render_html ───────────────────────────────────────────


@mcp.tool()
async def render_html(node_id: str = "", output_path: str = "") -> str:
    """Generate an interactive HTML visualization of the knowledge graph.

    Creates a standalone HTML file with vis.js force-directed graph.
    Nodes are colored by domain, edges styled by type.

    Args:
        node_id: Focus node (empty = entire graph)
        output_path: Output file path (default: data/mindmap.html)

    Returns:
        Path to the generated HTML file
    """
    g = _load_graph()
    if not g or not g.nodes:
        return _err("No knowledge graph exists yet")

    out = Path(output_path) if output_path else _graph_path.parent / "mindmap.html"

    # Determine included nodes
    if node_id and node_id in g.nodes:
        include_ids = set(g.get_subtree_ids(node_id, max_depth=5))
        for edge, other in g.get_non_tree_connections(node_id):
            include_ids.add(other.id)
    else:
        include_ids = set(g.nodes.keys())

    # Assign colors by domain
    domains = sorted({g.nodes[nid].domain for nid in include_ids if g.nodes[nid].domain})
    color_palette = [
        "#4ECDC4", "#FF6B6B", "#45B7D1", "#96CEB4", "#FFEAA7",
        "#DDA0DD", "#98D8C8", "#F7DC6F", "#82E0AA", "#F0B27A",
    ]
    domain_colors = {d: color_palette[i % len(color_palette)] for i, d in enumerate(domains)}

    # Build vis.js data
    vis_nodes = []
    for nid in include_ids:
        node = g.nodes[nid]
        size = 30 if nid == g.root_node_id else (20 if node.level <= 1 else 14)
        shape = "ellipse" if nid == g.root_node_id else "box"
        color = domain_colors.get(node.domain, "#CCCCCC")
        status_emoji = {"expanded": " ✓", "explored": "", "unexplored": " ?"}.get(node.status.value, "")
        vis_nodes.append({
            "id": nid,
            "label": node.label + status_emoji,
            "title": f"<b>{node.label}</b><br>{node.description}<br>Domain: {node.domain}<br>Status: {node.status.value}",
            "color": color,
            "size": size,
            "shape": shape,
            "font": {"size": 14},
        })

    vis_edges = []
    for edge in g.edges.values():
        if edge.source_id not in include_ids or edge.target_id not in include_ids:
            continue
        if edge.edge_type == EdgeType.PARENT_CHILD:
            vis_edges.append({
                "from": edge.source_id,
                "to": edge.target_id,
                "arrows": "to",
                "color": {"color": "#888888"},
                "width": 1.5,
            })
        else:
            label = edge.label or edge.edge_type.value
            vis_edges.append({
                "from": edge.source_id,
                "to": edge.target_id,
                "arrows": "to",
                "dashes": True,
                "color": {"color": "#FF6B6B"},
                "width": 1,
                "label": label,
                "font": {"size": 10, "color": "#FF6B6B"},
            })

    # Legend
    legend_items = [{"domain": d, "color": c} for d, c in domain_colors.items()]

    html = _build_html(
        title=g.name,
        nodes_json=json.dumps(vis_nodes, ensure_ascii=False),
        edges_json=json.dumps(vis_edges, ensure_ascii=False),
        legend_json=json.dumps(legend_items, ensure_ascii=False),
        stats=f"Nodes: {len(include_ids)} | Edges: {len(vis_edges)} | Domains: {len(domains)}",
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    return _ok({"format": "html", "path": str(out.resolve()), "nodes": len(vis_nodes), "edges": len(vis_edges)})


def _build_html(title: str, nodes_json: str, edges_json: str, legend_json: str, stats: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} - Knowledge MindMap</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #eee; }}
  #header {{ padding: 16px 24px; background: #16213e; border-bottom: 1px solid #0f3460; display: flex; justify-content: space-between; align-items: center; }}
  #header h1 {{ font-size: 20px; font-weight: 600; }}
  #header .stats {{ font-size: 13px; color: #aaa; }}
  #graph {{ width: 100%; height: calc(100vh - 60px); }}
  #legend {{ position: fixed; bottom: 20px; left: 20px; background: rgba(22,33,62,0.95); padding: 12px 16px; border-radius: 8px; border: 1px solid #0f3460; font-size: 12px; }}
  #legend h3 {{ margin-bottom: 8px; font-size: 13px; }}
  .legend-item {{ display: flex; align-items: center; margin: 4px 0; }}
  .legend-dot {{ width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; flex-shrink: 0; }}
  #detail {{ position: fixed; top: 70px; right: 20px; width: 320px; background: rgba(22,33,62,0.95); padding: 16px; border-radius: 8px; border: 1px solid #0f3460; display: none; font-size: 13px; }}
  #detail h3 {{ margin-bottom: 8px; font-size: 15px; }}
  #detail .field {{ margin: 6px 0; }}
  #detail .label {{ color: #aaa; }}
</style>
</head>
<body>
<div id="header">
  <h1>{title}</h1>
  <div class="stats">{stats}</div>
</div>
<div id="graph"></div>
<div id="legend"><h3>Domains</h3></div>
<div id="detail"></div>
<script>
const nodesData = {nodes_json};
const edgesData = {edges_json};
const legendData = {legend_json};

const container = document.getElementById("graph");
const data = {{
  nodes: new vis.DataSet(nodesData),
  edges: new vis.DataSet(edgesData)
}};
const options = {{
  layout: {{
    hierarchical: {{
      enabled: true,
      direction: "LR",
      sortMethod: "directed",
      levelSeparation: 200,
      nodeSpacing: 80,
    }}
  }},
  physics: {{
    enabled: true,
    hierarchicalRepulsion: {{ nodeDistance: 150, centralGravity: 0.1 }},
    stabilization: {{ iterations: 100 }}
  }},
  nodes: {{
    borderWidth: 1,
    borderWidthSelected: 2,
    font: {{ color: "#fff" }},
  }},
  edges: {{
    smooth: {{ type: "cubicBezier", roundness: 0.4 }},
  }},
  interaction: {{
    hover: true,
    tooltipDelay: 200,
  }},
}};

const network = new vis.Network(container, data, options);

// Legend
const legendEl = document.getElementById("legend");
legendData.forEach(item => {{
  const div = document.createElement("div");
  div.className = "legend-item";
  div.innerHTML = '<div class="legend-dot" style="background:' + item.color + '"></div>' + item.domain;
  legendEl.appendChild(div);
}});

// Click detail
const detailEl = document.getElementById("detail");
network.on("click", function(params) {{
  if (params.nodes.length > 0) {{
    const nodeId = params.nodes[0];
    const node = nodesData.find(n => n.id === nodeId);
    if (node) {{
      detailEl.style.display = "block";
      detailEl.innerHTML = '<h3>' + node.label + '</h3><div class="field">' + (node.title || '') + '</div>';
    }}
  }} else {{
    detailEl.style.display = "none";
  }}
}});
</script>
</body>
</html>"""


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
