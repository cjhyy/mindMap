import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/api_provider.dart';
import '../main.dart';
import '../widgets/node_tree.dart';
import 'agent_sheet.dart';

class GraphDetailScreen extends ConsumerWidget {
  const GraphDetailScreen({super.key, required this.graphId});

  final String graphId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Override active graph id
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(activeGraphIdProvider.notifier).state = graphId;
    });

    final graph = ref.watch(activeGraphProvider);
    final isWide = MediaQuery.sizeOf(context).width >= 768;

    return Scaffold(
      appBar: AppBar(
        title: graph.maybeWhen(
          data: (g) => Text(g?.name ?? graphId),
          orElse: () => Text(graphId),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(activeGraphProvider),
          ),
        ],
      ),
      body: graph.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('错误: $e', style: const TextStyle(color: AppColors.error))),
        data: (g) {
          if (g == null) return const Center(child: Text('图谱不存在'));

          final unexplored = g.unexploredCount;
          final noDocs = g.noDocCount;

          return Column(
            children: [
              // Stats bar
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                color: AppColors.surface,
                child: Row(
                  children: [
                    _Stat('${g.nodeCount}', '节点'),
                    const SizedBox(width: 16),
                    _Stat('${g.edgeCount}', '边'),
                    if (unexplored > 0) ...[
                      const SizedBox(width: 16),
                      _Stat('$unexplored', '未探索', warn: true),
                    ],
                    if (noDocs > 0) ...[
                      const SizedBox(width: 16),
                      _Stat('$noDocs', '缺文档', warn: true),
                    ],
                  ],
                ),
              ),
              const Divider(),
              // Tree
              Expanded(
                child: isWide
                    ? Row(children: [
                        SizedBox(width: 280, child: NodeTree(graph: g, graphId: graphId)),
                        const VerticalDivider(width: 1),
                        const Expanded(child: _NodePlaceholder()),
                      ])
                    : NodeTree(graph: g, graphId: graphId),
              ),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openAgent(context, ref),
        backgroundColor: AppColors.accentDim,
        foregroundColor: AppColors.accent,
        elevation: 0,
        icon: const Text('⚡', style: TextStyle(fontSize: 16)),
        label: const Text('Agent'),
      ),
    );
  }

  void _openAgent(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        side: BorderSide(color: AppColors.border),
      ),
      builder: (_) => ProviderScope(
        parent: ProviderScope.containerOf(context),
        child: AgentSheet(graphId: graphId),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label, {this.warn = false});
  final String value;
  final String label;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final color = warn ? AppColors.warn : AppColors.textMuted;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: GoogleFonts.jetBrainsMono(color: color, fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(width: 3),
        Text(label, style: GoogleFonts.jetBrainsMono(color: AppColors.textMuted, fontSize: 11)),
      ],
    );
  }
}

class _NodePlaceholder extends StatelessWidget {
  const _NodePlaceholder();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('← 选择节点查看详情', style: TextStyle(color: AppColors.textMuted)),
    );
  }
}
