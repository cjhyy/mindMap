"""Agent session management with interrupt/cancel support."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from uuid import uuid4

from app.config import PROJECT_DIR
from app.services.graph_service import graph_service

logger = logging.getLogger(__name__)


@dataclass
class AgentOperation:
    """A single, cancellable agent operation."""

    id: str = field(default_factory=lambda: f"op_{uuid4().hex[:12]}")
    graph_id: str = ""
    operation_type: str = ""  # create, expand, query, connect
    task: str = ""
    status: str = "pending"  # pending, running, completed, cancelled, failed
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    stream_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    result: str | None = None
    error: str | None = None
    duration_seconds: float | None = None
    turns: int | None = None
    tool_calls: int | None = None
    _task_handle: asyncio.Task | None = field(default=None, repr=False)


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
        # Verify graph exists
        if graph_service.get_graph(graph_id) is None:
            raise ValueError(f"Graph '{graph_id}' not found")

        op = AgentOperation(
            graph_id=graph_id,
            operation_type=operation_type,
            task=task,
        )
        self.operations[op.id] = op

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

    async def _run_agent(self, op: AgentOperation) -> None:
        import sys
        sys.path.insert(0, str(PROJECT_DIR))

        op.status = "running"
        start_time = time.time()

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

            # Register cancellation hook
            from mem_deep_research_core.core.hooks import hooks, HookContext

            hook_id = f"cancel_{op.id}"

            @hooks.register("on_turn_start", priority=100)
            def check_cancel(ctx: HookContext, original_fn):
                if op.cancel_event.is_set():
                    raise AgentCancelled(f"Operation {op.id} cancelled by user")
                return original_fn(ctx)

            # Register progress forwarding hook
            @hooks.register("on_tool_end", priority=5)
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

            @hooks.register("on_turn_end", priority=5)
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
