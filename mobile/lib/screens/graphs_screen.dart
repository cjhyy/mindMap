import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/api_provider.dart';
import '../models/graph.dart';
import '../main.dart';

class GraphsScreen extends ConsumerWidget {
  const GraphsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final graphs = ref.watch(graphListProvider);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('⬡', style: TextStyle(color: AppColors.accent, fontSize: 20)),
            const SizedBox(width: 8),
            const Text('MindMap'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/settings'),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(graphListProvider),
          ),
        ],
      ),
      body: graphs.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(error: e.toString(), onRetry: () => ref.invalidate(graphListProvider)),
        data: (list) => list.isEmpty
            ? _EmptyView(onCreateTap: () => _showCreateDialog(context, ref))
            : _GraphList(graphs: list, onRefresh: () => ref.invalidate(graphListProvider)),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateDialog(context, ref),
        backgroundColor: AppColors.accentDim,
        foregroundColor: AppColors.accent,
        elevation: 0,
        child: const Icon(Icons.add),
      ),
    );
  }

  void _showCreateDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.border),
        ),
        title: const Text('新建图谱', style: TextStyle(color: AppColors.textMain, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: AppColors.textMain),
          decoration: const InputDecoration(hintText: '图谱名称'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          ElevatedButton(
            onPressed: () async {
              if (controller.text.trim().isEmpty) return;
              Navigator.pop(ctx);
              await ref.read(apiClientProvider).createGraph(controller.text.trim());
              ref.invalidate(graphListProvider);
            },
            child: const Text('创建'),
          ),
        ],
      ),
    );
  }
}

class _GraphList extends ConsumerWidget {
  const _GraphList({required this.graphs, required this.onRefresh});

  final List<GraphMeta> graphs;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      color: AppColors.accent,
      backgroundColor: AppColors.surface,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: graphs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _GraphCard(graph: graphs[i], onRefresh: onRefresh),
      ),
    );
  }
}

class _GraphCard extends ConsumerWidget {
  const _GraphCard({required this.graph, required this.onRefresh});

  final GraphMeta graph;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: InkWell(
        onTap: () => context.push('/graph/${graph.id}'),
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(graph.name,
                        style: const TextStyle(
                            color: AppColors.textMain, fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(
                      '${graph.nodeCount} 节点 · ${graph.edgeCount} 边',
                      style: GoogleFonts.jetBrainsMono(
                          color: AppColors.textMuted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18),
                color: AppColors.textMuted,
                onPressed: () => _confirmDelete(context, ref),
              ),
              const Icon(Icons.chevron_right, color: AppColors.textMuted, size: 18),
            ],
          ),
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.border),
        ),
        title: const Text('删除图谱', style: TextStyle(color: AppColors.textMain)),
        content: Text('确认删除「${graph.name}」？', style: const TextStyle(color: AppColors.textMuted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
              child: const Text('取消', style: TextStyle(color: AppColors.textMuted))),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await ref.read(apiClientProvider).deleteGraph(graph.id);
              ref.invalidate(graphListProvider);
            },
            child: const Text('删除', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView({required this.onCreateTap});
  final VoidCallback onCreateTap;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('⬡', style: TextStyle(fontSize: 48, color: AppColors.border)),
          const SizedBox(height: 16),
          const Text('暂无图谱', style: TextStyle(color: AppColors.textMuted)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: onCreateTap, child: const Text('新建图谱')),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});
  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, color: AppColors.error, size: 40),
          const SizedBox(height: 12),
          Text('连接失败', style: const TextStyle(color: AppColors.textMain, fontSize: 14)),
          const SizedBox(height: 4),
          Text(error, style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: onRetry, child: const Text('重试')),
        ],
      ),
    );
  }
}
