#!/usr/bin/env python3
"""Run a single research task with the Knowledge MindMap Agent."""

import argparse
import asyncio
import os
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.resolve()
FRAMEWORK_DIR = PROJECT_DIR.parent / "mem-deep-research"

# Ensure framework and project are importable
if FRAMEWORK_DIR.exists():
    sys.path.insert(0, str(FRAMEWORK_DIR))
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


async def main():
    parser = argparse.ArgumentParser(description="Knowledge MindMap Agent")
    parser.add_argument("task", nargs="?", help="Research task description")
    parser.add_argument("--config", default="agent", help="Config name (default: agent)")
    parser.add_argument("--interactive", "-i", action="store_true", help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        from cli import interactive_loop
        await interactive_loop()
        return

    if not args.task:
        parser.error("Please provide a task or use --interactive mode")

    from mem_deep_research import DeepResearch

    dr = DeepResearch.from_project(PROJECT_DIR, config_name=args.config)

    try:
        result = await dr.run(args.task)
        print(f"\nStatus: {result.status}")
        print(f"Duration: {result.duration_seconds:.1f}s")
        print(f"Turns: {result.turns} | Tool calls: {result.tool_calls}")
        print(f"\n{result.answer}")
    finally:
        await dr.close()


if __name__ == "__main__":
    asyncio.run(main())
