import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/api_provider.dart';
import '../main.dart';

enum AgentMode { auto, create, expand, query, connect }

const _modeLabels = {
  AgentMode.auto: '自动完善',
  AgentMode.create: '创建图谱',
  AgentMode.expand: '展开节点',
  AgentMode.query: '自由查询',
  AgentMode.connect: '发现连接',
};

class AgentSheet extends ConsumerStatefulWidget {
  const AgentSheet({super.key, required this.graphId});
  final String graphId;

  @override
  ConsumerState<AgentSheet> createState() => _AgentSheetState();
}

class _AgentSheetState extends ConsumerState<AgentSheet> {
  AgentMode _mode = AgentMode.auto;
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final opState = ref.watch(operationProvider);
    final notifier = ref.read(operationProvider.notifier);
    final isRunning = notifier.isRunning;
    final events = opState.valueOrNull ?? [];

    // Auto scroll
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, scrollCtrl) => Column(
        children: [
          // Handle
          Center(
            child: Container(
              width: 40, height: 4,
              margin: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.border2,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Text('⚡', style: TextStyle(fontSize: 16)),
                const SizedBox(width: 8),
                const Text('Agent', style: TextStyle(color: AppColors.textMain, fontSize: 16, fontWeight: FontWeight.w600)),
                const Spacer(),
                if (isRunning)
                  TextButton(
                    onPressed: notifier.cancel,
                    child: const Text('停止', style: TextStyle(color: AppColors.error, fontSize: 13)),
                  ),
              ],
            ),
          ),

          const Divider(),

          // Mode chips
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: AgentMode.values.map((m) {
                final selected = _mode == m;
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: FilterChip(
                    label: Text(_modeLabels[m]!, style: TextStyle(
                      color: selected ? AppColors.accent : AppColors.textMuted,
                      fontSize: 12,
                    )),
                    selected: selected,
                    onSelected: (_) => setState(() => _mode = m),
                    backgroundColor: AppColors.surface2,
                    selectedColor: AppColors.accentDim,
                    side: BorderSide(color: selected ? AppColors.accentDim : AppColors.border),
                    showCheckmark: false,
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                  ),
                );
              }).toList(),
            ),
          ),

          // Input (if needed)
          if (_mode == AgentMode.create || _mode == AgentMode.expand || _mode == AgentMode.query)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: _mode == AgentMode.expand
                  ? _NodeDropdown(graphId: widget.graphId, controller: _inputCtrl)
                  : TextField(
                      controller: _inputCtrl,
                      style: const TextStyle(color: AppColors.textMain, fontSize: 13),
                      maxLines: 3,
                      minLines: 2,
                      decoration: InputDecoration(
                        hintText: _mode == AgentMode.create ? '描述要构建的知识领域...' : '输入查询内容...',
                      ),
                    ),
            ),

          // Stream log
          Expanded(
            child: ListView.builder(
              controller: _scrollCtrl,
              padding: const EdgeInsets.all(16),
              itemCount: events.isEmpty && !isRunning ? 1 : events.length + (isRunning ? 1 : 0),
              itemBuilder: (_, i) {
                if (events.isEmpty && !isRunning) {
                  return const Center(
                    child: Text('选择模式后点击运行', style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
                  );
                }
                if (i < events.length) return _EventTile(event: events[i]);
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: [
                      const SizedBox(
                        width: 14, height: 14,
                        child: CircularProgressIndicator(strokeWidth: 1.5, color: AppColors.warn),
                      ),
                      const SizedBox(width: 8),
                      Text('Agent 运行中...', style: GoogleFonts.jetBrainsMono(color: AppColors.warn, fontSize: 11)),
                    ],
                  ),
                );
              },
            ),
          ),

          // Run button
          Padding(
            padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.viewInsetsOf(context).bottom + 16),
            child: SizedBox(
              width: double.infinity,
              child: isRunning
                  ? OutlinedButton(
                      onPressed: notifier.cancel,
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.error),
                        foregroundColor: AppColors.error,
                      ),
                      child: const Text('停止'),
                    )
                  : ElevatedButton(
                      onPressed: _handleRun,
                      child: Text('运行 ${_modeLabels[_mode]}'),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleRun() async {
    final notifier = ref.read(operationProvider.notifier);
    final api = ref.read(apiClientProvider);
    final gid = widget.graphId;
    final input = _inputCtrl.text.trim();

    await notifier.startOperation(() => switch (_mode) {
          AgentMode.auto => api.agentAuto(gid),
          AgentMode.create => api.agentCreate(gid, input.isEmpty ? '构建知识图谱' : input),
          AgentMode.expand => api.agentExpand(gid, input),
          AgentMode.query => api.agentQuery(gid, input),
          AgentMode.connect => api.agentConnect(gid),
        });
  }
}

class _NodeDropdown extends ConsumerWidget {
  const _NodeDropdown({required this.graphId, required this.controller});
  final String graphId;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final graph = ref.watch(activeGraphProvider).valueOrNull;
    final labels = graph?.nodes.values.map((n) => n.label).toList() ?? [];

    return DropdownButtonFormField<String>(
      value: controller.text.isEmpty ? null : controller.text,
      dropdownColor: AppColors.surface2,
      style: const TextStyle(color: AppColors.textMain, fontSize: 13),
      hint: const Text('选择节点...', style: TextStyle(color: AppColors.textMuted)),
      decoration: const InputDecoration(),
      items: labels.map((l) => DropdownMenuItem(value: l, child: Text(l))).toList(),
      onChanged: (v) { if (v != null) controller.text = v; },
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});
  final Map<String, dynamic> event;

  @override
  Widget build(BuildContext context) {
    final type = event['_event_type'] as String? ?? event['type'] as String? ?? 'message';

    if (type == 'heartbeat') return const SizedBox.shrink();

    if (type == 'tool_call') {
      return Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Row(
          children: [
            Text('T${event['turn'] ?? ''}',
                style: GoogleFonts.jetBrainsMono(color: AppColors.textMuted, fontSize: 11)),
            const SizedBox(width: 8),
            Text('${event['tool'] ?? ''}',
                style: GoogleFonts.jetBrainsMono(color: AppColors.nodeExplored, fontSize: 11)),
            if (event['duration_ms'] != null) ...[
              const SizedBox(width: 6),
              Text('${event['duration_ms']}ms',
                  style: GoogleFonts.jetBrainsMono(color: AppColors.textMuted, fontSize: 10)),
            ],
          ],
        ),
      );
    }

    if (type == 'done') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('── 完成 ${(event['duration'] as num?)?.toStringAsFixed(1) ?? '?'}s ──',
              style: GoogleFonts.jetBrainsMono(color: AppColors.accent, fontSize: 11)),
          if (event['result'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 8),
              child: Text('${event['result']}',
                  style: const TextStyle(color: AppColors.textMain, fontSize: 12, height: 1.5)),
            ),
        ],
      );
    }

    if (type == 'cancelled') {
      return Text('── 已取消 ──',
          style: GoogleFonts.jetBrainsMono(color: AppColors.warn, fontSize: 11));
    }

    if (type == 'started') {
      return Text('── 开始 ──',
          style: GoogleFonts.jetBrainsMono(color: AppColors.textMuted, fontSize: 11));
    }

    return const SizedBox.shrink();
  }
}
