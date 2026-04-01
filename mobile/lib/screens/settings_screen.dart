import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/api_provider.dart';
import '../main.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _urlCtrl;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: ref.read(baseUrlProvider));
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const _SectionTitle('服务器'),
          const SizedBox(height: 8),
          TextField(
            controller: _urlCtrl,
            style: const TextStyle(color: AppColors.textMain, fontSize: 13),
            decoration: const InputDecoration(
              labelText: 'API Base URL',
              labelStyle: TextStyle(color: AppColors.textMuted),
              hintText: 'http://192.168.1.x:8000/api',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: () {
                    final url = _urlCtrl.text.trim();
                    if (url.isEmpty) return;
                    ref.read(baseUrlProvider.notifier).state = url;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('已保存'),
                        backgroundColor: AppColors.accentDim,
                        duration: Duration(seconds: 2),
                      ),
                    );
                  },
                  child: const Text('保存'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: () {
                  _urlCtrl.text = _defaultBaseUrl;
                  ref.read(baseUrlProvider.notifier).state = _defaultBaseUrl;
                },
                child: const Text('重置'),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const _SectionTitle('提示'),
          const SizedBox(height: 8),
          const Text(
            '在同一 Wi-Fi 网络下，将 localhost 替换为电脑的局域网 IP 地址（如 192.168.1.100:8000/api），即可从手机访问后端。',
            style: TextStyle(color: AppColors.textMuted, fontSize: 13, height: 1.6),
          ),
        ],
      ),
    );
  }
}

const _defaultBaseUrl = 'http://localhost:8000/api';

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        color: AppColors.textMuted,
        fontSize: 10,
        letterSpacing: 2,
        fontWeight: FontWeight.w500,
      ),
    );
  }
}
