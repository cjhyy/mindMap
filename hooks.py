"""Knowledge MindMap Agent hooks.

Customizes framework behavior for the mindmap workflow:
- Log tool calls with mindmap-specific context
- Format graph tool results concisely
- Inject existing graph state at session start
"""

import json
import logging
from pathlib import Path

from mem_deep_research_core.core.hooks import HookContext, hooks

logger = logging.getLogger(__name__)

MUTATION_TOOLS = {
    "create_mindmap",
    "add_node",
    "add_nodes_batch",
    "update_node",
    "add_edge",
    "delete_node",
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
        logger.info(f"[MindMap] END {tool} | {duration} | mutation={tool in MUTATION_TOOLS}")
    return original_fn(ctx)


@hooks.register("on_tool_result_format", priority=10)
def format_mindmap_result(ctx: HookContext, original_fn):
    """Format mindmap tool results. Keep render output full, truncate large queries."""
    tool = ctx.tool_name or ""
    result = ctx.tool_result or {}
    error = result.get("error")
    dur = f"{ctx.duration_ms}ms" if ctx.duration_ms else ""

    if error:
        return f"[{tool}] Error: {str(error)[:120]} ({dur})"

    # Render tools and graph summary: keep full output
    if tool.startswith("render_") or tool == "get_graph_summary":
        return original_fn(ctx)

    # Mutation tools: concise confirmation
    if tool in MUTATION_TOOLS:
        content = result.get("content", [])
        if content and isinstance(content, list):
            text = content[0].get("text", "") if content else ""
            if len(text) > 500:
                text = text[:500] + "...[truncated]"
            return f"[{tool}] OK ({dur}): {text}"

    return original_fn(ctx)


@hooks.register("on_turn_end", priority=10)
def log_turn_progress(ctx: HookContext, original_fn):
    total = ctx.extra.get("total_tool_calls", 0)
    msgs = ctx.extra.get("message_count", 0)
    logger.info(
        f"[Turn {ctx.turn_number}] {ctx.tool_calls_count} tool calls this turn, "
        f"{total} total, {msgs} messages"
    )
    return original_fn(ctx)


@hooks.register("on_system_prompt_build", priority=5)
def inject_graph_state(ctx: HookContext, original_fn):
    """Inject existing graph state summary so the agent knows the current state."""
    prompt = original_fn(ctx)

    graph_path = Path(__file__).parent / "data" / "knowledge_graph.json"
    if graph_path.exists():
        try:
            data = json.loads(graph_path.read_text(encoding="utf-8"))
            node_count = len(data.get("nodes", {}))
            edge_count = len(data.get("edges", {}))
            graph_name = data.get("name", "Untitled")
            if node_count > 0:
                prompt += (
                    f"\n\n[已有知识图谱]\n"
                    f"名称: {graph_name}\n"
                    f"节点数: {node_count}, 边数: {edge_count}\n"
                    f"请先调用 get_graph_summary 查看完整结构后再进行操作。\n"
                )
        except Exception:
            pass

    return prompt
