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

# Track consecutive read-only tool calls to detect stalling
_readonly_streak = 0
_READONLY_TOOLS = {"get_subtree", "get_graph_summary", "search_knowledge"}
_MAX_READONLY_STREAK = 3

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
    global _file_logger, _current_log_path, _readonly_streak
    _readonly_streak = 0
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
    """Filter out tools the agent shouldn't call, including stalling read-only loops."""
    global _readonly_streak
    batch = original_fn(ctx)
    if not batch or not isinstance(batch, list):
        return batch

    # Check if ALL calls in this batch are read-only
    tool_names = []
    for call in batch:
        name = getattr(call, 'tool_name', '') or (call.get('tool_name', '') if isinstance(call, dict) else '')
        tool_names.append(name)

    all_readonly = all(n in _READONLY_TOOLS for n in tool_names if n)
    if all_readonly and tool_names:
        _readonly_streak += 1
    else:
        _readonly_streak = 0

    if _readonly_streak > _MAX_READONLY_STREAK:
        flog(f"T{ctx.turn_number} ⊘ BLOCKED read-only stall ({_readonly_streak} consecutive turns of {tool_names})")
        return []

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
            # After mutation, append compact key-map so agent sees latest state
            keymap = _build_compact_keymap()
            if keymap:
                return f"[{tool}] OK ({dur}): {text}\n\n[图谱实时状态]\n{keymap}"
            return f"[{tool}] OK ({dur}): {text}"

    return original_fn(ctx)


@hooks.register("on_system_prompt_build", priority=5)
def inject_graph_state(ctx: HookContext, original_fn):
    """Inject a compact key-map of the graph into system prompt."""
    prompt = original_fn(ctx)

    keymap = _build_compact_keymap()
    if keymap:
        prompt += f"\n\n[当前图谱状态]\n{keymap}"
        prompt += (
            "\n\n[重要规则]"
            "\n- 完成任务后立即停止，不要反复调用 get_subtree 或 get_graph_summary 来确认。"
            "\n- 如果你已经完成了所有要求的操作（添加节点、生成文档等），直接输出总结并结束。"
            "\n- 不要连续多次调用只读工具（get_subtree、get_graph_summary），一次足够。"
        )
        flog(f"[Graph State]\n{keymap}")

    return prompt


def _build_compact_keymap() -> str:
    """Build a compact key-map string from the current graph file."""
    try:
        from backend.tools.mindmap_manager_server import _graph_path
        if not _graph_path.exists():
            return ""
        data = json.loads(_graph_path.read_text(encoding="utf-8"))
        nodes = data.get("nodes", {})
        if not nodes:
            return ""
        edges = data.get("edges", {})
        docs = sum(1 for n in nodes.values() if n.get("has_doc"))
        unexplored = sum(1 for n in nodes.values() if n.get("status") == "unexplored")
        no_doc = sum(1 for n in nodes.values() if not n.get("has_doc") and n.get("level", 0) >= 1)

        children_of: dict[str, list] = {}
        for e in edges.values():
            if e.get("edge_type") == "parent_child":
                children_of.setdefault(e["source_id"], []).append(e["target_id"])

        lines = [f"节点:{len(nodes)} 文档:{docs} 未探索:{unexplored} 缺文档:{no_doc}"]
        root_id = data.get("root_node_id")

        def render(nid: str, depth: int) -> None:
            node = nodes.get(nid)
            if not node or depth > 3:
                return
            indent = "  " * depth
            label = node.get("label", "?")
            status = node.get("status", "unexplored")
            has_doc = node.get("has_doc", False)
            mark = "✓" if status == "expanded" else ("○" if status == "explored" else "·")
            doc_mark = " 📄" if has_doc else ""
            lines.append(f"{indent}{mark} {label}{doc_mark}")
            for cid in children_of.get(nid, []):
                render(cid, depth + 1)

        if root_id:
            render(root_id, 0)
        else:
            for nid, n in nodes.items():
                if not n.get("parent_id"):
                    render(nid, 0)
        return "\n".join(lines)
    except Exception:
        return ""


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
