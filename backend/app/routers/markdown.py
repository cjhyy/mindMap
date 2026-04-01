"""Markdown export (with full details) and import/update endpoints."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from backend.app.config import PROJECT_DIR
from backend.app.schemas import MarkdownExport, MarkdownImportRequest, MarkdownImportResult
from backend.app.services.graph_service import graph_service

from backend.tools.models import (
    EdgeType, KnowledgeEdge, KnowledgeGraph, KnowledgeNode, NodeStatus, _now_iso,
)

router = APIRouter(prefix="/api/graphs/{graph_id}/markdown", tags=["markdown"])


# ── Export: full detailed Markdown ──────────────────────────


@router.get("/export", response_model=MarkdownExport)
async def export_markdown(graph_id: str):
    """Export the knowledge graph as a comprehensive Markdown document.

    Each node includes: description, domain, tags, status, connections, sources.
    The format is designed to be human-editable and re-importable.
    """
    g = _load_graph(graph_id)
    content = _render_full_markdown(g)
    return MarkdownExport(
        content=content,
        node_count=len(g.nodes),
        edge_count=len(g.edges),
    )


@router.get("/export/file")
async def export_markdown_file(graph_id: str):
    """Download the knowledge graph as a .md file."""
    g = _load_graph(graph_id)
    content = _render_full_markdown(g)
    import urllib.parse
    safe_name = urllib.parse.quote(g.name)
    return PlainTextResponse(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}.md",
        },
    )


# ── Import: parse edited Markdown back into graph ──────────


@router.put("/import", response_model=MarkdownImportResult)
async def import_markdown(graph_id: str, req: MarkdownImportRequest):
    """Parse user-edited Markdown and update the graph.

    Recognizes the format produced by export. Supports:
    - Editing node descriptions, tags, domains
    - Adding new nodes under existing parents (via indentation)
    - Updating node status

    Node IDs in backticks (e.g. `abc123`) are used to match existing nodes.
    Nodes without IDs are treated as new additions.
    """
    g = _load_graph(graph_id)
    result = _parse_and_update(g, req.content)

    # Save
    path = graph_service.get_graph_path(graph_id)
    g.save(path)
    graph_service.update_meta_from_graph(graph_id)

    return result


# ── Render full Markdown ────────────────────────────────────


def _render_full_markdown(g: KnowledgeGraph) -> str:
    """Generate comprehensive Markdown with all node details."""
    lines: list[str] = []

    # Header
    root_label = g.nodes[g.root_node_id].label if (g.root_node_id and g.root_node_id in g.nodes) else g.name
    lines.append(f"# {root_label}")
    lines.append("")
    if g.description:
        lines.append(f"> {g.description}")
        lines.append("")
    lines.append(f"**节点数**: {len(g.nodes)} | **连接数**: {len(g.edges)} | **领域**: {', '.join(g.get_domains())}")
    lines.append("")

    # Status legend
    lines.append("<!-- 状态说明: [x]=已展开 [-]=已探索 [ ]=待探索 -->")
    lines.append("<!-- 编辑说明: 修改描述/标签后可通过 import 接口同步回图谱 -->")
    lines.append("")

    # Table of contents
    has_root = g.root_node_id and g.root_node_id in g.nodes
    if has_root:
        lines.append("## 目录")
        lines.append("")
        for child in g.get_children(g.root_node_id):
            count = len(g.get_children(child.id))
            lines.append(f"- [{child.label}](#{_slug(child.label)}) ({count} 子节点)")
        lines.append("")

    # Render each top-level branch with full details
    lines.append("---")
    lines.append("")

    if has_root:
        for child in g.get_children(g.root_node_id):
            _render_branch(g, child, 2, lines)

    # Cross-connections section
    cross_edges = [e for e in g.edges.values() if e.edge_type != EdgeType.PARENT_CHILD]
    if cross_edges:
        lines.append("---")
        lines.append("")
        lines.append("## 跨领域连接")
        lines.append("")
        lines.append("| 起点 | 关系 | 终点 | 类型 |")
        lines.append("|------|------|------|------|")
        for e in cross_edges:
            src = g.nodes.get(e.source_id)
            tgt = g.nodes.get(e.target_id)
            if src and tgt:
                label = e.label or e.edge_type.value
                lines.append(f"| {src.label} | {label} | {tgt.label} | `{e.edge_type.value}` |")
        lines.append("")

    # All nodes index (for reference / editing)
    lines.append("---")
    lines.append("")
    lines.append("## 节点索引")
    lines.append("")
    lines.append("<!-- 编辑此处的描述和标签，然后通过 import 接口更新图谱 -->")
    lines.append("")
    for node in sorted(g.nodes.values(), key=lambda n: (n.domain, n.level, n.label)):
        status_icon = {"expanded": "✅", "explored": "🔍", "unexplored": "⬜"}.get(node.status.value, "⬜")
        lines.append(f"### {status_icon} {node.label} `{node.id}`")
        lines.append("")
        lines.append(f"- **领域**: {node.domain}")
        lines.append(f"- **状态**: {node.status.value}")
        lines.append(f"- **层级**: {node.level}")
        if node.tags:
            lines.append(f"- **标签**: {', '.join(node.tags)}")
        if node.description:
            lines.append(f"- **描述**: {node.description}")
        if node.source_urls:
            lines.append(f"- **来源**:")
            for url in node.source_urls:
                lines.append(f"  - {url}")

        # Show connections
        connections = g.get_non_tree_connections(node.id)
        if connections:
            lines.append(f"- **关联**:")
            for edge, other in connections:
                label = edge.label or edge.edge_type.value
                lines.append(f"  - → {other.label} ({label})")

        lines.append("")

    return "\n".join(lines)


def _render_branch(g: KnowledgeGraph, node: KnowledgeNode, heading_level: int, lines: list[str]) -> None:
    """Render a branch with its children as a tree outline with details."""
    h = "#" * min(heading_level, 4)
    icon = _status_icon(node.status)

    lines.append(f"{h} {icon} {node.label} `{node.id}`")
    lines.append("")

    if node.domain:
        lines.append(f"**领域**: `{node.domain}`")
    if node.description:
        lines.append(f"\n{node.description}")
    if node.tags:
        lines.append(f"\n**标签**: {', '.join(node.tags)}")
    lines.append("")

    # Children as sub-sections or bullet list
    children = g.get_children(node.id)
    if children:
        if heading_level < 4:
            for child in children:
                _render_branch(g, child, heading_level + 1, lines)
        else:
            # Too deep for headings, use bullet list
            for child in children:
                icon = _status_icon(child.status)
                desc = f" - _{child.description}_" if child.description else ""
                lines.append(f"- {icon} **{child.label}** `{child.id}`{desc}")
                if child.tags:
                    lines.append(f"  标签: {', '.join(child.tags)}")
                # Sub-children as indented bullets
                for sub in g.get_children(child.id):
                    sub_icon = _status_icon(sub.status)
                    sub_desc = f" - _{sub.description}_" if sub.description else ""
                    lines.append(f"  - {sub_icon} {sub.label} `{sub.id}`{sub_desc}")
            lines.append("")


# ── Parse Markdown and update graph ─────────────────────────


def _parse_and_update(g: KnowledgeGraph, content: str) -> MarkdownImportResult:
    """Parse the node index section and update node fields."""
    nodes_updated = 0
    nodes_added = 0
    errors: list[str] = []

    # Parse the "节点索引" section - each node block starts with ### ... `node_id`
    # Format: ### ✅ Node Label `abc123`
    node_pattern = re.compile(
        r'^###\s+(?:[✅🔍⬜]\s+)?(.+?)\s+`([a-f0-9]{8})`\s*$',
        re.MULTILINE,
    )

    matches = list(node_pattern.finditer(content))

    for i, match in enumerate(matches):
        node_label = match.group(1).strip()
        node_id = match.group(2).strip()

        # Extract the block content until next ### or end
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        block = content[start:end].strip()

        if node_id in g.nodes:
            # Update existing node
            node = g.nodes[node_id]
            changed = False

            # Update label if changed
            if node_label and node_label != node.label:
                node.label = node_label
                changed = True

            # Parse fields from block
            new_desc = _extract_field(block, "描述")
            new_tags = _extract_field(block, "标签")
            new_domain = _extract_field(block, "领域")
            new_status = _extract_field(block, "状态")
            new_sources = _extract_list_field(block, "来源")

            if new_desc is not None and new_desc != node.description:
                node.description = new_desc
                changed = True
            if new_tags is not None:
                tag_list = [t.strip() for t in new_tags.split(",") if t.strip()]
                if tag_list != node.tags:
                    node.tags = tag_list
                    changed = True
            if new_domain is not None and new_domain != node.domain:
                node.domain = new_domain
                changed = True
            if new_status is not None:
                try:
                    s = NodeStatus(new_status)
                    if s != node.status:
                        node.status = s
                        changed = True
                except ValueError:
                    errors.append(f"Node '{node_label}': invalid status '{new_status}'")
            if new_sources is not None and new_sources != node.source_urls:
                node.source_urls = new_sources
                changed = True

            if changed:
                node.updated_at = _now_iso()
                nodes_updated += 1
        else:
            errors.append(f"Node ID '{node_id}' not found in graph (label: {node_label})")

    # Also scan for new nodes added as bullet points under existing sections
    # Format: - ⬜ **New Node Label** - Description here
    new_node_pattern = re.compile(
        r'^-\s+(?:[✅🔍⬜]\s+)?\*\*(.+?)\*\*(?:\s+`[a-f0-9]{8}`)?\s*(?:-\s*_(.+?)_)?',
        re.MULTILINE,
    )

    # Find heading context for parent assignment
    heading_pattern = re.compile(r'^#{2,4}\s+(?:[✅🔍⬜]\s+)?(.+?)\s+`([a-f0-9]{8})`', re.MULTILINE)
    headings = list(heading_pattern.finditer(content))

    for match in new_node_pattern.finditer(content):
        label = match.group(1).strip()
        desc = match.group(2).strip() if match.group(2) else ""

        # Skip if node with exact id already exists (has backtick id in the line)
        line = content[match.start():match.end()]
        id_match = re.search(r'`([a-f0-9]{8})`', line)
        if id_match and id_match.group(1) in g.nodes:
            continue

        # Find the parent heading (closest heading before this line)
        parent_id = None
        for h in reversed(headings):
            if h.start() < match.start():
                parent_id = h.group(2)
                break

        if parent_id and parent_id in g.nodes:
            # Check if a node with this label already exists under this parent
            existing = [n for n in g.get_children(parent_id) if n.label == label]
            if existing:
                continue

            parent = g.nodes[parent_id]
            new_node = KnowledgeNode(
                label=label,
                description=desc,
                domain=parent.domain,
                level=parent.level + 1,
                parent_id=parent_id,
            )
            g.nodes[new_node.id] = new_node

            new_edge = KnowledgeEdge(
                source_id=parent_id,
                target_id=new_node.id,
                edge_type=EdgeType.PARENT_CHILD,
                label="contains",
            )
            g.edges[new_edge.id] = new_edge
            nodes_added += 1

    return MarkdownImportResult(
        nodes_updated=nodes_updated,
        nodes_added=nodes_added,
        errors=errors,
    )


# ── Helpers ─────────────────────────────────────────────────


def _extract_field(block: str, field_name: str) -> str | None:
    """Extract a field value from a block like '- **领域**: value'."""
    pattern = re.compile(rf'^\s*-\s+\*\*{re.escape(field_name)}\*\*:\s*(.+)$', re.MULTILINE)
    m = pattern.search(block)
    if m:
        return m.group(1).strip()
    return None


def _extract_list_field(block: str, field_name: str) -> list[str] | None:
    """Extract a list field (items on indented lines after the field header)."""
    pattern = re.compile(
        rf'^\s*-\s+\*\*{re.escape(field_name)}\*\*:\s*$',
        re.MULTILINE,
    )
    m = pattern.search(block)
    if not m:
        return None

    items = []
    remaining = block[m.end():]
    for line in remaining.split("\n"):
        stripped = line.strip()
        if stripped.startswith("- "):
            items.append(stripped[2:].strip())
        elif stripped and not stripped.startswith("-"):
            break
    return items if items else None


def _status_icon(status: NodeStatus) -> str:
    return {"expanded": "[x]", "explored": "[-]", "unexplored": "[ ]"}.get(status.value, "[ ]")


def _slug(text: str) -> str:
    return text.lower().replace(" ", "-").replace("/", "-")


def _load_graph(graph_id: str) -> KnowledgeGraph:
    g = graph_service.get_graph(graph_id)
    if not g:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return g
