import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../providers/api_provider.dart';
import '../models/graph.dart';
import '../main.dart';
import '../widgets/status_badge.dart';

class NodeDetailScreen extends ConsumerStatefulWidget {
  const NodeDetailScreen({super.key, required this.graphId, required this.nodeId});

  final String graphId;
  final String nodeId;

  @override
  ConsumerState<NodeDetailScreen> createState() => _NodeDetailScreenState();
}

class _NodeDetailScreenState extends ConsumerState<NodeDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  String? _docContent;
  bool _loadingDoc = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _tabs.addListener(() {
      if (_tabs.index == 1) _loadDoc();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadDoc() async {
    if (_docContent != null || _loadingDoc) return;
    setState(() => _loadingDoc = true);
    try {
      final content = await ref.read(apiClientProvider).getNodeDoc(widget.graphId, widget.nodeId);
      setState(() => _docContent = content);
    } catch (_) {
      setState(() => _docContent = '');
    } finally {
      setState(() => _loadingDoc = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final graphAsync = ref.watch(activeGraphProvider);

    return graphAsync.when(
      loading: () => Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(appBar: AppBar(), body: Center(child: Text('$e'))),
      data: (graph) {
        final node = graph?.nodes[widget.nodeId];
        if (node == null) {
          return Scaffold(appBar: AppBar(title: const Text('节点不存在')));
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(node.label),
            bottom: TabBar(
              controller: _tabs,
              indicatorColor: AppColors.accent,
              labelColor: AppColors.accent,
              unselectedLabelColor: AppColors.textMuted,
              tabs: [
                const Tab(text: '信息'),
                Tab(text: node.hasDoc ? '文档 📄' : '文档'),
              ],
            ),
          ),
          body: TabBarView(
            controller: _tabs,
            children: [
              _InfoTab(node: node),
              _DocTab(
                hasDoc: node.hasDoc,
                content: _docContent,
                loading: _loadingDoc,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _InfoTab extends StatelessWidget {
  const _InfoTab({required this.node});
  final NodeData node;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status row
        Row(
          children: [
            StatusBadge(status: node.status.name),
            const SizedBox(width: 8),
            if (node.domain.isNotEmpty)
              _Tag(node.domain, color: AppColors.nodeExplored, borderColor: const Color(0xFF1E3A5F)),
          ],
        ),
        const SizedBox(height: 16),

        if (node.description.isNotEmpty) ...[
          _Section(
            title: '描述',
            child: Text(node.description,
                style: const TextStyle(color: AppColors.textMain, fontSize: 14, height: 1.6)),
          ),
          const SizedBox(height: 16),
        ],

        if (node.tags.isNotEmpty) ...[
          _Section(
            title: '标签',
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: node.tags.map((t) => _Tag(t)).toList(),
            ),
          ),
          const SizedBox(height: 16),
        ],

        _Section(
          title: '元数据',
          child: Column(
            children: [
              _MetaRow('层级', 'L${node.level}'),
              _MetaRow('深度', node.contentDepth.name),
              _MetaRow('有文档', node.hasDoc ? '是 📄' : '否'),
            ],
          ),
        ),
      ],
    );
  }
}

class _DocTab extends StatelessWidget {
  const _DocTab({required this.hasDoc, required this.content, required this.loading});

  final bool hasDoc;
  final String? content;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    if (!hasDoc) {
      return const Center(
        child: Text('该节点尚无文档，可通过 Agent 生成。',
            style: TextStyle(color: AppColors.textMuted)),
      );
    }
    if (loading) return const Center(child: CircularProgressIndicator());
    if (content == null || content!.isEmpty) {
      return const Center(child: Text('文档加载失败', style: TextStyle(color: AppColors.error)));
    }

    return Markdown(
      data: content!,
      padding: const EdgeInsets.all(16),
      styleSheet: MarkdownStyleSheet(
        p: const TextStyle(color: AppColors.textMain, fontSize: 14, height: 1.7),
        h1: const TextStyle(color: AppColors.textMain, fontSize: 20, fontWeight: FontWeight.w700),
        h2: const TextStyle(color: AppColors.textMain, fontSize: 17, fontWeight: FontWeight.w600),
        h3: const TextStyle(color: AppColors.textMain, fontSize: 15, fontWeight: FontWeight.w600),
        blockquote: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        code: const TextStyle(color: AppColors.accent, fontSize: 12, backgroundColor: AppColors.accentDim),
        codeblockDecoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.border),
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title.toUpperCase(),
            style: const TextStyle(
                color: AppColors.textMuted, fontSize: 10, letterSpacing: 2, fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        child,
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, {this.color = AppColors.textMuted, this.borderColor = AppColors.border2});
  final String text;
  final Color color;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        border: Border.all(color: borderColor),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(text, style: TextStyle(color: color, fontSize: 11)),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
          const Spacer(),
          Text(value, style: const TextStyle(color: AppColors.textMain, fontSize: 12)),
        ],
      ),
    );
  }
}
