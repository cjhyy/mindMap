"""Knowledge MindMap Agent hooks."""

import json
import logging
from pathlib import Path

from mem_deep_research_core.core.hooks import HookContext, hooks

logger = logging.getLogger(__name__)

MUTATION_TOOLS = {
    "create_mindmap", "add_node", "add_nodes_batch",
    "update_node", "add_edge", "delete_node",
    "generate_node_doc", "update_node_doc",
}


@hooks.register("on_tool_start", priority=10)
def log_tool_start(ctx: HookContext, original_fn):
    args_str = json.dumps(ctx.arguments or {}, ensure_ascii=False, default=str)[:300]
    logger.info(f"[MindMap] START {ctx.tool_name} | args={args_str}")
    return original_fn(ctx)


@hooks.register("on_tool_end", priority=10)
def log_tool_end(ctx: HookContext, original_fn):
    duration = f"{ctx.duration_ms}ms" if ctx.duration_ms else "?"
    tool = ctx.tool_name or ""
    error = (ctx.tool_result or {}).get("error")
    if error:
        logger.info(f"[MindMap] END {tool} | {duration} | ERROR: {error}")
    else:
        logger.info(f"[MindMap] END {tool} | {duration}")
    return original_fn(ctx)


@hooks.register("on_tool_result_format", priority=10)
def format_mindmap_result(ctx: HookContext, original_fn):
    tool = ctx.tool_name or ""
    result = ctx.tool_result or {}
    error = result.get("error")
    dur = f"{ctx.duration_ms}ms" if ctx.duration_ms else ""

    if error:
        return f"[{tool}] Error: {str(error)[:120]} ({dur})"

    if tool == "get_graph_summary":
        return original_fn(ctx)

    if tool in MUTATION_TOOLS:
        content = result.get("content", [])
        if content and isinstance(content, list):
            text = content[0].get("text", "") if content else ""
            if len(text) > 500:
                text = text[:500] + "..."
            return f"[{tool}] OK ({dur}): {text}"

    return original_fn(ctx)


@hooks.register("on_system_prompt_build", priority=5)
def inject_graph_state(ctx: HookContext, original_fn):
    """Inject a compact key-map of the graph into system prompt.

    Only includes: node label, status, has_doc, level.
    This gives the Agent enough context to decide what to do next
    without wasting tokens on full descriptions.
    """
    prompt = original_fn(ctx)

    try:
        from tools.mindmap_manager_server import _graph_path
        graph_path = _graph_path
    except ImportError:
        graph_path = Path(__file__).parent / "data" / "knowledge_graph.json"

    if not graph_path.exists():
        return prompt

    try:
        data = json.loads(graph_path.read_text(encoding="utf-8"))
        nodes = data.get("nodes", {})
        if not nodes:
            return prompt

        edges = data.get("edges", {})
        graph_name = data.get("name", "Untitled")

        # Count stats
        cross_edges = sum(1 for e in edges.values() if e.get("edge_type") != "parent_child")
        docs_count = sum(1 for n in nodes.values() if n.get("has_doc"))
        unexplored = sum(1 for n in nodes.values() if n.get("status") == "unexplored")

        # Build compact key-map: indented tree with status markers
        root_id = data.get("root_node_id")
        lines = [
            f"\n[当前图谱] {graph_name}",
            f"节点:{len(nodes)} 边:{len(edges)} 跨域连接:{cross_edges} 文档:{docs_count} 未探索:{unexplored}",
            "",
        ]

        # Build parent→children index
        children_of: dict[str, list] = {}
        for e in edges.values():
            if e.get("edge_type") == "parent_child":
                pid = e.get("source_id", "")
                children_of.setdefault(pid, []).append(e.get("target_id", ""))

        def render_tree(nid: str, depth: int) -> None:
            node = nodes.get(nid)
            if not node:
                return
            indent = "  " * depth
            label = node.get("label", "?")
            status = node.get("status", "unexplored")
            has_doc = node.get("has_doc", False)

            # Status markers: ✓=expanded ○=explored ·=unexplored 📄=has doc
            mark = "✓" if status == "expanded" else ("○" if status == "explored" else "·")
            doc_mark = " 📄" if has_doc else ""
            lines.append(f"{indent}{mark} {label}{doc_mark}")

            for child_id in children_of.get(nid, []):
                render_tree(child_id, depth + 1)

        if root_id:
            render_tree(root_id, 0)
        else:
            for nid, n in nodes.items():
                if not n.get("parent_id"):
                    render_tree(nid, 0)

        prompt += "\n".join(lines)

    except Exception:
        pass

    return prompt
