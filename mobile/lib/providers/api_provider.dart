import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../models/graph.dart';

// ── Configuration ─────────────────────────────────────────

const _defaultBaseUrl = 'http://localhost:8000/api';

final baseUrlProvider = StateProvider<String>((ref) => _defaultBaseUrl);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(baseUrl: ref.watch(baseUrlProvider));
});

// ── Graph list ─────────────────────────────────────────────

final graphListProvider = FutureProvider<List<GraphMeta>>((ref) {
  return ref.watch(apiClientProvider).listGraphs();
});

// ── Active graph ───────────────────────────────────────────

final activeGraphIdProvider = StateProvider<String?>((ref) => null);

final activeGraphProvider = FutureProvider<GraphDetail?>((ref) async {
  final id = ref.watch(activeGraphIdProvider);
  if (id == null) return null;
  return ref.watch(apiClientProvider).getGraph(id);
});

// ── Active node ────────────────────────────────────────────

final activeNodeIdProvider = StateProvider<String?>((ref) => null);

// ── Operations stream ──────────────────────────────────────

class OperationNotifier extends StateNotifier<AsyncValue<List<Map<String, dynamic>>>> {
  OperationNotifier(this._client) : super(const AsyncValue.data([]));

  final ApiClient _client;
  String? _currentOpId;
  bool _running = false;

  bool get isRunning => _running;
  String? get currentOpId => _currentOpId;

  Future<void> startOperation(Future<String> Function() starter) async {
    state = const AsyncValue.data([]);
    _running = true;

    try {
      _currentOpId = await starter();
      _collect(_currentOpId!);
    } catch (e, st) {
      _running = false;
      state = AsyncValue.error(e, st);
    }
  }

  void _collect(String opId) {
    final events = <Map<String, dynamic>>[];
    _client.streamOperation(opId).listen(
      (event) {
        events.add(event);
        state = AsyncValue.data(List.unmodifiable(events));
        final type = event['_event_type'] as String?;
        if (type == 'done' || type == 'cancelled') {
          _running = false;
        }
      },
      onError: (e) { _running = false; },
      onDone: () { _running = false; },
    );
  }

  Future<void> cancel() async {
    if (_currentOpId == null) return;
    await _client.cancelOperation(_currentOpId!);
    _running = false;
    _currentOpId = null;
  }
}

final operationProvider =
    StateNotifierProvider<OperationNotifier, AsyncValue<List<Map<String, dynamic>>>>((ref) {
  return OperationNotifier(ref.watch(apiClientProvider));
});
