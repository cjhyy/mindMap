import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/graph.dart';
import '../main.dart';
import 'status_badge.dart';

class NodeTree extends StatelessWidget {
  const NodeTree({super.key, required this.graph, required this.graphId});

  final GraphDetail graph;
  final String graphId;

  @override
  Widget build(BuildContext context) {
    final roots = graph.rootIds;
    if (roots.isEmpty) {
      return const Center(
        child: Text('图谱为空', style: TextStyle(color: AppColors.textMuted)),
      );
    }
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: roots.map((id) => _NodeTile(
        nodeId: id,
        graph: graph,
        graphId: graphId,
        depth: 0,
      )).toList(),
    );
  }
}

class _NodeTile extends StatefulWidget {
  const _NodeTile({
    required this.nodeId,
    required this.graph,
    required this.graphId,
    required this.depth,
  });

  final String nodeId;
  final GraphDetail graph;
  final String graphId;
  final int depth;

  @override
  State<_NodeTile> createState() => _NodeTileState();
}

class _NodeTileState extends State<_NodeTile> {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.depth < 2;
  }

  @override
  Widget build(BuildContext context) {
    final node = widget.graph.nodes[widget.nodeId];
    if (node == null) return const SizedBox.shrink();

    final children = widget.graph.childrenOf(widget.nodeId);
    final hasChildren = children.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: () {
            if (hasChildren) setState(() => _expanded = !_expanded);
            context.push('/graph/${widget.graphId}/node/${widget.nodeId}');
          },
          child: Padding(
            padding: EdgeInsets.only(
              left: 12.0 + widget.depth * 16.0,
              right: 12,
              top: 6,
              bottom: 6,
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 16,
                  child: hasChildren
                      ? Icon(
                          _expanded ? Icons.arrow_drop_down : Icons.arrow_right,
                          size: 16,
                          color: AppColors.textMuted,
                        )
                      : null,
                ),
                const SizedBox(width: 4),
                NodeStatusIcon(status: node.status),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    node.label,
                    style: const TextStyle(color: AppColors.textMain, fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (node.hasDoc) ...[
                  const SizedBox(width: 4),
                  const Text('📄', style: TextStyle(fontSize: 11)),
                ],
              ],
            ),
          ),
        ),
        if (_expanded && hasChildren)
          ...children.map((cid) => _NodeTile(
                nodeId: cid,
                graph: widget.graph,
                graphId: widget.graphId,
                depth: widget.depth + 1,
              )),
      ],
    );
  }
}
