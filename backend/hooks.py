"""Knowledge MindMap Agent hooks — with file logging."""

import json
import logging
from datetime import datetime
from pathlib import Path

from mem_deep_research_core.core.hooks import HookContext, hooks

logger = logging.getLogger(__name__)

MUTATION_TOOLS = {
    "create_mindmap", "add_node", "add_nodes_batch",
    "update_node", "add_edge",
    "generate_node_doc", "update_node_doc",
}

# Tools the agent should NOT call during building phase
# (delete_node is allowed — LLM uses it for dedup in final turns)
BLOCKED_TOOLS: set[str] = set()

# ── File logger: one log file per agent run ──

LOG_DIR = Path(__file__).parent / "logs" / "agent_runs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

_file_logger: logging.Logger | None = None
_current_log_path: Path | None = None


def _get_file_logger() -> logging.Logger:
    """Get or create a file logger for the current agent run."""
    global _file_logger, _current_log_path
    if _file_logger is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        _current_log_path = LOG_DIR / f"run_{ts}.log"
        _file_logger = logging.getLogger(f"agent_run_{ts}")
        _file_logger.setLevel(logging.DEBUG)
        _file_logger.propagate = False
        # Remove old handlers
        _file_logger.handlers.clear()
        fh = logging.FileHandler(_current_log_path, encoding="utf-8")
        fh.setFormatter(logging.Formatter("%(asctime)s  %(message)s", datefmt="%H:%M:%S"))
        _file_logger.addHandler(fh)
    return _file_logger


def reset_file_logger():
    """Start a new log file (called at the beginning of each agent operation)."""
    global _file_logger, _current_log_path
    if _file_logger:
        for h in _file_logger.handlers:
            h.close()
        _file_logger.handlers.clear()
    _file_logger = None
    _current_log_path = None


def flog(msg: str):
    """Write to both console logger and the run log file."""
    logger.info(msg)
    _get_file_logger().info(msg)


# ── Hooks ──

@hooks.register("on_tool_start", priority=10)
def log_tool_start(ctx: HookContext, original_fn):
    args_str = json.dumps(ctx.arguments or {}, ensure_ascii=False, default=str)[:500]
    flog(f"T{ctx.turn_number} ⚙ START {ctx.tool_name} | args={args_str}")
    return original_fn(ctx)


@hooks.register("on_tool_end", priority=10)
def log_tool_end(ctx: HookContext, original_fn):
    duration = f"{ctx.duration_ms}ms" if ctx.duration_ms else "?"
    tool = ctx.tool_name or ""
    result_raw = ctx.tool_result or {}

    # Extract key info from result
    error = result_raw.get("error")
    if error:
        flog(f"T{ctx.turn_number} ✗ END   {tool} | {duration} | ERROR: {error}")
    else:
        # Log a summary of the result
        result_summary = _summarize_result(tool, result_raw)
        flog(f"T{ctx.turn_number} ✓ END   {tool} | {duration} | {result_summary}")

    return original_fn(ctx)


@hooks.register("on_tool_filter", priority=10)
def block_wasteful_tools(ctx: HookContext, original_fn):
    """Filter out tools the agent shouldn't call."""
    batch = original_fn(ctx)
    if not batch or not isinstance(batch, list):
        return batch
    filtered = []
    for call in batch:
        tool_name = getattr(call, 'tool_name', '') or (call.get('tool_name', '') if isinstance(call, dict) else '')
        if tool_name in BLOCKED_TOOLS:
            flog(f"T{ctx.turn_number} ⊘ BLOCKED {tool_name}")
        else:
            filtered.append(call)
    return filtered


@hooks.register("on_turn_start", priority=8)
def log_turn_start(ctx: HookContext, original_fn):
    flog(f"── Turn {ctx.turn_number} ──")
    return original_fn(ctx)


@hooks.register("on_turn_end", priority=8)
def log_turn_end(ctx: HookContext, original_fn):
    flog(f"── Turn {ctx.turn_number} done · {ctx.tool_calls_count} tools ──")
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
    """Inject a compact key-map of the graph into system prompt."""
    prompt = original_fn(ctx)

    try:
        from backend.tools.mindmap_manager_server import _graph_path
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

        cross_edges = sum(1 for e in edges.values() if e.get("edge_type") != "parent_child")
        docs_count = sum(1 for n in nodes.values() if n.get("has_doc"))
        unexplored = sum(1 for n in nodes.values() if n.get("status") == "unexplored")

        root_id = data.get("root_node_id")
        lines = [
            f"\n[当前图谱] {graph_name}",
            f"节点:{len(nodes)} 边:{len(edges)} 跨域连接:{cross_edges} 文档:{docs_count} 未探索:{unexplored}",
            "",
        ]

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

        graph_state = "\n".join(lines)
        prompt += graph_state

        # Also log the graph state to file
        flog(f"[Graph State]\n{graph_state}")

    except Exception:
        pass

    return prompt


def _summarize_result(tool: str, result: dict) -> str:
    """Extract a short summary from a tool result."""
    content = result.get("content", [])
    if not content:
        return "ok"
    if isinstance(content, list) and content:
        text = content[0].get("text", "") if isinstance(content[0], dict) else str(content[0])
        # Parse JSON results for key info
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                if "node_id" in parsed:
                    return f"node={parsed['node_id']} label={parsed.get('label', '?')}"
                if "created_ids" in parsed:
                    return f"created {len(parsed['created_ids'])} nodes"
                if "format" in parsed:
                    return f"format={parsed['format']}"
                # Generic: show first few keys
                keys = list(parsed.keys())[:4]
                return ", ".join(f"{k}={str(parsed[k])[:30]}" for k in keys)
        except (json.JSONDecodeError, TypeError):
            pass
        return text[:100]
    return "ok"
