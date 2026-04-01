import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';

import 'screens/graphs_screen.dart';
import 'screens/graph_detail_screen.dart';
import 'screens/node_detail_screen.dart';
import 'screens/settings_screen.dart';

void main() {
  runApp(const ProviderScope(child: MindMapApp()));
}

final _router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (_, __) => const GraphsScreen()),
    GoRoute(
      path: '/graph/:id',
      builder: (_, state) => GraphDetailScreen(graphId: state.pathParameters['id']!),
    ),
    GoRoute(
      path: '/graph/:graphId/node/:nodeId',
      builder: (_, state) => NodeDetailScreen(
        graphId: state.pathParameters['graphId']!,
        nodeId: state.pathParameters['nodeId']!,
      ),
    ),
    GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
  ],
);

class MindMapApp extends StatelessWidget {
  const MindMapApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'MindMap',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      routerConfig: _router,
    );
  }

  ThemeData _buildTheme() {
    const bg = Color(0xFF0D0F0E);
    const surface = Color(0xFF131615);
    const surface2 = Color(0xFF1A1D1B);
    const border = Color(0xFF252926);
    const textMain = Color(0xFFD4D8D5);
    const textMuted = Color(0xFF6B7570);
    const accent = Color(0xFF4ADE80);

    final base = ThemeData.dark();
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      colorScheme: const ColorScheme.dark(
        surface: surface,
        primary: accent,
        onPrimary: bg,
        secondary: accent,
        onSecondary: bg,
      ),
      textTheme: GoogleFonts.notoSerifScTextTheme(base.textTheme).copyWith(
        bodyMedium: GoogleFonts.notoSerifSc(color: textMain, fontSize: 14),
        bodySmall: GoogleFonts.jetBrainsMono(color: textMuted, fontSize: 12),
        titleMedium: GoogleFonts.notoSerifSc(color: textMain, fontWeight: FontWeight.w600),
        titleLarge: GoogleFonts.notoSerifSc(color: textMain, fontWeight: FontWeight.w700, fontSize: 20),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: textMain,
        elevation: 0,
        titleTextStyle: GoogleFonts.notoSerifSc(color: textMain, fontSize: 16, fontWeight: FontWeight.w600),
        iconTheme: const IconThemeData(color: textMuted),
      ),
      dividerTheme: const DividerThemeData(color: border, thickness: 1, space: 0),
      listTileTheme: const ListTileThemeData(
        tileColor: Colors.transparent,
        iconColor: textMuted,
      ),
      cardTheme: CardTheme(
        color: surface2,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: border),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface2,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: accent),
        ),
        hintStyle: GoogleFonts.notoSerifSc(color: textMuted, fontSize: 14),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF1A3D25),
          foregroundColor: accent,
          side: const BorderSide(color: Color(0xFF1A3D25)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: GoogleFonts.notoSerifSc(fontSize: 14, fontWeight: FontWeight.w500),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textMuted,
          side: const BorderSide(color: border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: GoogleFonts.notoSerifSc(fontSize: 13),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          elevation: 0,
        ),
      ),
      extensions: const [AppColors()],
    );
  }
}

class AppColors extends ThemeExtension<AppColors> {
  const AppColors();

  static const bg = Color(0xFF0D0F0E);
  static const surface = Color(0xFF131615);
  static const surface2 = Color(0xFF1A1D1B);
  static const border = Color(0xFF252926);
  static const border2 = Color(0xFF2E3330);
  static const textMain = Color(0xFFD4D8D5);
  static const textMuted = Color(0xFF6B7570);
  static const accent = Color(0xFF4ADE80);
  static const accentDim = Color(0xFF1A3D25);
  static const warn = Color(0xFFF59E0B);
  static const error = Color(0xFFF87171);
  static const nodeUnexplored = Color(0xFF6B7570);
  static const nodeExplored = Color(0xFF60A5FA);
  static const nodeExpanded = Color(0xFF4ADE80);

  @override
  AppColors copyWith() => const AppColors();
  @override
  AppColors lerp(AppColors? other, double t) => const AppColors();
}
