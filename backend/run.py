#!/usr/bin/env python3
"""Run the Knowledge MindMap Agent with auto-continue.

If the graph still has unexplored nodes or missing docs after one run,
automatically starts another round. Max rounds configurable via --rounds.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent.resolve()  # mindMap/
sys.path.insert(0, str(PROJECT_DIR))

# Load .env
env_file = PROJECT_DIR / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def check_graph_status() -> dict:
    """Check current graph state to decide if another round is needed.

    Reads the most recently updated graph in data/graphs/.
    """
    graphs_dir = PROJECT_DIR / "data" / "graphs"
    # Find most recently modified graph.json
    graph_files = sorted(graphs_dir.glob("*/graph.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not graph_files:
        return {"exists": False, "nodes": 0, "unexplored": 0, "no_doc": 0}

    graph_path = graph_files[0]
    data = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", {})
    unexplored = sum(1 for n in nodes.values() if n.get("status") == "unexplored")
    no_doc = sum(1 for n in nodes.values()
                 if n.get("status") != "unexplored"
                 and not n.get("has_doc")
                 and n.get("level", 0) >= 1)
    return {
        "exists": True,
        "nodes": len(nodes),
        "unexplored": unexplored,
        "no_doc": no_doc,
    }


async def main():
    parser = argparse.ArgumentParser(description="Knowledge MindMap Agent")
    parser.add_argument("task", help="Research task description")
    parser.add_argument("--config", default="agent", help="Config name")
    parser.add_argument("--rounds", type=int, default=3, help="Max auto-continue rounds (default: 3)")
    args = parser.parse_args()

    from mem_deep_research import DeepResearch

    total_turns = 0
    total_tools = 0
    total_duration = 0.0

    for round_num in range(1, args.rounds + 1):
        # Decide task for this round
        if round_num == 1:
            task = args.task
        else:
            status = check_graph_status()
            if status["unexplored"] == 0 and status["no_doc"] == 0:
                print(f"\n✅ 图谱已完成：{status['nodes']} 节点，全部已探索且有文档")
                break

            task = "继续完善知识图谱"
            if status["unexplored"] > 0:
                task += f"，还有 {status['unexplored']} 个未探索节点需要展开"
            if status["no_doc"] > 0:
                task += f"，还有 {status['no_doc']} 个核心节点缺少文档"

        print(f"\n{'='*60}")
        print(f"  Round {round_num}/{args.rounds}: {task[:60]}...")
        print(f"{'='*60}")

        dr = DeepResearch.from_project(PROJECT_DIR / "backend", config_name=args.config)
        try:
            result = await dr.run(task)
            total_turns += result.turns or 0
            total_tools += result.tool_calls or 0
            total_duration += result.duration_seconds or 0

            print(f"\n[Round {round_num}] {result.status} | {result.duration_seconds:.0f}s | {result.turns} turns | {result.tool_calls} tools")

            if result.error:
                print(f"  Error: {result.error}")
        finally:
            await dr.close()

        # Check if we should continue
        status = check_graph_status()
        remaining = status["unexplored"] + status["no_doc"]
        print(f"  Graph: {status['nodes']} nodes | {status['unexplored']} unexplored | {status['no_doc']} need docs")

        if remaining == 0:
            print(f"\n✅ 图谱已完成")
            break

    # Final summary
    print(f"\n{'='*60}")
    print(f"  Total: {total_duration:.0f}s | {total_turns} turns | {total_tools} tool calls")
    status = check_graph_status()
    print(f"  Graph: {status['nodes']} nodes | {status['unexplored']} unexplored | {status['no_doc']} need docs")

    # List generated docs (across all graph subdirs)
    docs = list((PROJECT_DIR / "data" / "graphs").glob("*/docs/*.md"))
    if docs:
        print(f"  Documents: {len(docs)}")
        for d in sorted(docs):
            print(f"    📄 {d.stem} ({d.stat().st_size:,} bytes)")
    print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
