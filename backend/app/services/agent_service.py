"""Agent session management with interrupt/cancel support."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from uuid import uuid4

from app.config import PROJECT_DIR
from app.services.graph_service import graph_service

logger = logging.getLogger(__name__)

# Max completed operations to keep in memory
_MAX_FINISHED_OPS = 100


@dataclass
class AgentOperation:
    """A single, cancellable agent operation."""

    id: str = field(default_factory=lambda: f"op_{uuid4().hex[:12]}")
    graph_id: str = ""
    operation_type: str = ""  # create, expand, query, connect
    task: str = ""
    status: str = "pending"  # pending, running, completed, cancelled, failed
    result: str | None = None
    error: str | None = None
    duration_seconds: float | None = None
    turns: int | None = None
    tool_calls: int | None = None
    _cancel_event: asyncio.Event | None = field(default=None, repr=False)
    _stream_queue: asyncio.Queue | None = field(default=None, repr=False)
    _task_handle: asyncio.Task | None = field(default=None, repr=False)
    _finished_at: float | None = field(default=None, repr=False)

    def __post_init__(self):
        self._cancel_event = asyncio.Event()
        self._stream_queue = asyncio.Queue()

    @property
    def cancel_event(self) -> asyncio.Event:
        return self._cancel_event

    @property
    def stream_queue(self) -> asyncio.Queue:
        return self._stream_queue


class AgentCancelled(Exception):
    """Raised when an agent operation is cancelled by the user."""
    pass


class AgentService:
    """Manages agent operations with cancellation support."""

    def __init__(self):
        self.operations: dict[str, AgentOperation] = {}

    async def start_operation(
        self, graph_id: str, operation_type: str, task: str,
    ) -> AgentOperation:
        # Validate graph_id format (prevent path traversal)
        if not re.match(r'^[a-f0-9]{8}$', graph_id):
            raise ValueError(f"Invalid graph_id format: '{graph_id}'")

        # Verify graph exists
        if graph_service.get_graph(graph_id) is None:
            raise ValueError(f"Graph '{graph_id}' not found")

        op = AgentOperation(
            graph_id=graph_id,
            operation_type=operation_type,
            task=task,
        )
        self.operations[op.id] = op

        # Cleanup old finished operations
        self._cleanup_finished()

        # Run agent in background
        op._task_handle = asyncio.create_task(self._run_agent(op))
        return op

    async def cancel_operation(self, op_id: str) -> AgentOperation | None:
        op = self.operations.get(op_id)
        if not op:
            return None
        if op.status != "running":
            return op

        # Signal the agent to stop
        op.cancel_event.set()
        op.status = "cancelled"

        # Also cancel the asyncio task
        if op._task_handle and not op._task_handle.done():
            op._task_handle.cancel()

        await op.stream_queue.put({
            "type": "cancelled",
            "message": "Operation cancelled by user",
        })

        logger.info(f"Operation {op_id} cancelled")
        return op

    def get_operation(self, op_id: str) -> AgentOperation | None:
        return self.operations.get(op_id)

    def list_operations(self, graph_id: str | None = None) -> list[AgentOperation]:
        ops = list(self.operations.values())
        if graph_id:
            ops = [op for op in ops if op.graph_id == graph_id]
        ops.sort(key=lambda o: o.id, reverse=True)
        return ops

    def _cleanup_finished(self) -> None:
        """Remove oldest finished operations if over the limit."""
        finished = [
            (op_id, op._finished_at or 0)
            for op_id, op in self.operations.items()
            if op.status in ("completed", "cancelled", "failed") and op._finished_at
        ]
        if len(finished) <= _MAX_FINISHED_OPS:
            return

        # Sort by finish time, remove oldest
        finished.sort(key=lambda x: x[1])
        to_remove = len(finished) - _MAX_FINISHED_OPS
        for op_id, _ in finished[:to_remove]:
            del self.operations[op_id]

    async def _run_agent(self, op: AgentOperation) -> None:
        import sys
        sys.path.insert(0, str(PROJECT_DIR))

        op.status = "running"
        start_time = time.time()
        registered_hooks: list[tuple[str, object]] = []

        await op.stream_queue.put({
            "type": "started",
            "operation_id": op.id,
            "operation_type": op.operation_type,
        })

        try:
            # Configure MCP tools to use the correct graph file
            graph_path = graph_service.get_graph_path(op.graph_id)

            from tools.mindmap_manager_server import set_graph_path as mgr_set_path, reset_graph
            from tools.mindmap_renderer_server import set_graph_path as rdr_set_path

            mgr_set_path(graph_path)
            rdr_set_path(graph_path)
            reset_graph()

            # Register hooks (track them for cleanup)
            from mem_deep_research_core.core.hooks import hooks, HookContext

            def check_cancel(ctx: HookContext, original_fn):
                if op.cancel_event.is_set():
                    raise AgentCancelled(f"Operation {op.id} cancelled by user")
                return original_fn(ctx)

            def forward_tool_progress(ctx: HookContext, original_fn):
                result = original_fn(ctx)
                try:
                    op.stream_queue.put_nowait({
                        "type": "tool_call",
                        "tool": ctx.tool_name,
                        "duration_ms": ctx.duration_ms,
                        "turn": ctx.turn_number,
                    })
                except asyncio.QueueFull:
                    pass
                return result

            def forward_turn_progress(ctx: HookContext, original_fn):
                result = original_fn(ctx)
                try:
                    op.stream_queue.put_nowait({
                        "type": "turn_end",
                        "turn": ctx.turn_number,
                        "tool_calls": ctx.tool_calls_count,
                    })
                except asyncio.QueueFull:
                    pass
                return result

            hooks.register_fn("on_turn_start", check_cancel, priority=100)
            hooks.register_fn("on_tool_end", forward_tool_progress, priority=5)
            hooks.register_fn("on_turn_end", forward_turn_progress, priority=5)
            registered_hooks = [
                ("on_turn_start", check_cancel),
                ("on_tool_end", forward_tool_progress),
                ("on_turn_end", forward_turn_progress),
            ]

            # Run the agent
            from mem_deep_research import DeepResearch

            dr = DeepResearch.from_project(PROJECT_DIR, config_name="agent")
            try:
                agent_result = await dr.run(op.task, stream_queue=op.stream_queue)

                op.status = "completed"
                op.result = agent_result.answer
                op.turns = agent_result.turns
                op.tool_calls = agent_result.tool_calls

            except AgentCancelled:
                op.status = "cancelled"
                logger.info(f"Operation {op.id} cancelled during execution")

            except Exception as e:
                op.status = "failed"
                op.error = str(e)
                logger.error(f"Operation {op.id} failed: {e}")

            finally:
                await dr.close()

        except Exception as e:
            op.status = "failed"
            op.error = str(e)
            logger.error(f"Operation {op.id} setup failed: {e}")

        finally:
            op.duration_seconds = time.time() - start_time
            op._finished_at = time.time()

            # Unregister hooks to prevent accumulation
            from mem_deep_research_core.core.hooks import hooks
            for hook_name, fn in registered_hooks:
                try:
                    hooks._hooks[hook_name] = [
                        (p, f) for p, f in hooks._hooks.get(hook_name, [])
                        if f is not fn
                    ]
                except Exception:
                    pass

            # Update graph metadata
            graph_service.update_meta_from_graph(op.graph_id)

            await op.stream_queue.put({
                "type": "done",
                "status": op.status,
                "duration": op.duration_seconds,
                "result": op.result[:500] if op.result else None,
                "error": op.error,
            })

            logger.info(
                f"Operation {op.id} finished: status={op.status}, "
                f"duration={op.duration_seconds:.1f}s"
            )


agent_service = AgentService()
