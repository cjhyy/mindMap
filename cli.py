#!/usr/bin/env python3
"""
Interactive Knowledge MindMap CLI.

Commands:
  /new <topic>          - Start a new knowledge map
  /expand <node_label>  - Expand a specific node
  /view                 - Show current mindmap (Mermaid)
  /view tree            - Show as Markdown outline
  /view html            - Generate HTML visualization
  /view graph           - Show Mermaid flowchart with cross-connections
  /status               - Show graph summary
  /detail <node_label>  - Show node details
  /connect              - Find cross-connections for all unexplored areas
  /export html          - Export as HTML
  /help                 - Show this help
  /quit                 - Exit

Any other input is sent as a free-form query to the agent.
"""

import asyncio
import os
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.resolve()
FRAMEWORK_DIR = PROJECT_DIR.parent / "mem-deep-research"

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


HELP_TEXT = """
╔══════════════════════════════════════════════════════════════╗
║                  Knowledge MindMap Agent                     ║
╠══════════════════════════════════════════════════════════════╣
║  /new <topic>         创建新的知识图谱                        ║
║  /expand <节点名>      展开某个知识节点                        ║
║  /view                查看思维导图 (Mermaid)                  ║
║  /view tree           查看大纲视图 (Markdown)                 ║
║  /view html           生成 HTML 可视化                        ║
║  /view graph          查看带跨领域连接的流程图                  ║
║  /status              查看图谱概览                            ║
║  /detail <节点名>      查看节点详情                            ║
║  /connect             发现跨领域连接                          ║
║  /help                显示帮助                               ║
║  /quit                退出                                   ║
║                                                              ║
║  直接输入任意文字将作为自由问题发送给 Agent                      ║
╚══════════════════════════════════════════════════════════════╝
""".strip()


def transform_command(user_input: str) -> str:
    """Convert slash commands into agent-friendly task descriptions."""
    cmd = user_input.strip()

    if cmd.startswith("/new "):
        topic = cmd[5:].strip()
        return (
            f"请为我创建一个关于「{topic}」的知识思维导图。"
            f"先搜索研究这个领域，识别主要知识分类，"
            f"构建初始知识图谱结构，然后展示结果。"
        )

    if cmd.startswith("/expand "):
        node_label = cmd[8:].strip()
        return (
            f"请展开知识图谱中的「{node_label}」节点。"
            f"深入研究这个主题，添加详细的子节点，"
            f"查找与现有节点的跨领域连接，然后展示更新后的导图。"
        )

    if cmd == "/view":
        return "请用 Mermaid mindmap 格式渲染当前知识图谱。"

    if cmd == "/view tree":
        return "请用 Markdown 大纲格式渲染当前知识图谱。"

    if cmd == "/view html":
        return "请生成当前知识图谱的交互式 HTML 可视化，并告诉我文件路径。"

    if cmd == "/view graph":
        return "请用 Mermaid flowchart 格式渲染知识图谱，展示跨领域连接关系。"

    if cmd == "/status":
        return "请展示当前知识图谱的概览：节点数、边数、未探索节点、顶层结构。"

    if cmd.startswith("/detail "):
        node_label = cmd[8:].strip()
        return f"请查找并展示「{node_label}」节点的详细信息。"

    if cmd == "/connect":
        return (
            "请分析当前知识图谱中的关键节点，"
            "找出可能的跨领域连接，并创建有意义的边。"
        )

    if cmd.startswith("/export "):
        fmt = cmd[8:].strip()
        return f"请将当前知识图谱导出为 {fmt} 格式。"

    # Free-form: send as-is
    return cmd


async def interactive_loop():
    """Main interactive REPL loop."""
    from mem_deep_research import DeepResearch

    dr = DeepResearch.from_project(PROJECT_DIR, config_name="agent")

    print(HELP_TEXT)
    print()

    while True:
        try:
            user_input = input("\n🧠 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if not user_input:
            continue

        if user_input == "/quit":
            print("再见！")
            break

        if user_input == "/help":
            print(HELP_TEXT)
            continue

        task = transform_command(user_input)

        try:
            print("⏳ 正在思考...")
            result = await dr.run(task)

            print(f"\n{'─' * 60}")
            print(result.answer)
            print(f"{'─' * 60}")
            print(f"[{result.status} | {result.duration_seconds:.1f}s | {result.turns} turns | {result.tool_calls} tool calls]")

            if result.error:
                print(f"⚠️  {result.error}")

        except Exception as e:
            print(f"\n❌ 错误: {e}")

    await dr.close()


if __name__ == "__main__":
    asyncio.run(interactive_loop())
