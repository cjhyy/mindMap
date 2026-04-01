import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/graph.dart';
import '../main.dart';

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status, this.small = true});

  final String status;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final (color, border, mark) = _style(status);
    final fs = small ? 11.0 : 12.0;

    return Container(
      padding: EdgeInsets.symmetric(horizontal: small ? 6 : 8, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(mark, style: GoogleFonts.jetBrainsMono(color: color, fontSize: fs)),
          const SizedBox(width: 4),
          Text(status, style: GoogleFonts.jetBrainsMono(color: color, fontSize: fs)),
        ],
      ),
    );
  }

  (Color, Color, String) _style(String s) => switch (s) {
        'expanded' => (AppColors.nodeExpanded, AppColors.accentDim, '✓'),
        'explored' => (AppColors.nodeExplored, const Color(0xFF1E3A5F), '○'),
        'completed' => (AppColors.nodeExpanded, AppColors.accentDim, '✓'),
        'running' => (AppColors.warn, const Color(0xFF3D2800), '◎'),
        'failed' => (AppColors.error, const Color(0xFF3D1010), '✗'),
        'cancelled' => (AppColors.textMuted, AppColors.border, '✕'),
        _ => (AppColors.textMuted, AppColors.border, '·'),
      };
}

class NodeStatusIcon extends StatelessWidget {
  const NodeStatusIcon({super.key, required this.status, this.size = 14});

  final NodeStatus status;
  final double size;

  @override
  Widget build(BuildContext context) {
    final (color, mark) = switch (status) {
      NodeStatus.expanded => (AppColors.nodeExpanded, '✓'),
      NodeStatus.explored => (AppColors.nodeExplored, '○'),
      NodeStatus.unexplored => (AppColors.textMuted, '·'),
    };
    return Text(mark, style: GoogleFonts.jetBrainsMono(color: color, fontSize: size));
  }
}
