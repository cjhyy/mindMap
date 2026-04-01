import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import '../models/graph.dart';

class ApiClient {
  ApiClient({required String baseUrl})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(minutes: 10),
          headers: {'Content-Type': 'application/json'},
        ));

  final Dio _dio;

  // ── Graphs ────────────────────────────────────────────────

  Future<List<GraphMeta>> listGraphs() async {
    final res = await _dio.get<List>('/graphs');
    return (res.data ?? [])
        .cast<Map<String, dynamic>>()
        .map(GraphMeta.fromJson)
        .toList();
  }

  Future<GraphMeta> createGraph(String name, {String description = ''}) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/graphs',
      data: {'name': name, 'description': description},
    );
    return GraphMeta.fromJson(res.data!);
  }

  Future<GraphDetail> getGraph(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/graphs/$id');
    return GraphDetail.fromJson(res.data!);
  }

  Future<void> deleteGraph(String id) => _dio.delete('/graphs/$id');

  // ── Nodes ─────────────────────────────────────────────────

  Future<String> getNodeDoc(String graphId, String nodeId) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/graphs/$graphId/nodes/$nodeId/doc',
    );
    return res.data?['content'] as String? ?? '';
  }

  // ── Render ────────────────────────────────────────────────

  Future<String> renderMarkdown(String graphId, {int maxDepth = 5}) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/graphs/$graphId/render/markdown',
      queryParameters: {'max_depth': maxDepth},
    );
    return res.data?['markdown'] as String? ?? '';
  }

  // ── Agent ─────────────────────────────────────────────────

  Future<String> agentAuto(String graphId) => _agentPost(graphId, 'auto');
  Future<String> agentConnect(String graphId) => _agentPost(graphId, 'connect');

  Future<String> agentCreate(String graphId, String task, {String background = ''}) =>
      _agentPost(graphId, 'create', {'task': task, 'background': background});

  Future<String> agentExpand(String graphId, String nodeLabel) =>
      _agentPost(graphId, 'expand', {'node_label': nodeLabel});

  Future<String> agentQuery(String graphId, String query) =>
      _agentPost(graphId, 'query', {'query': query});

  Future<String> _agentPost(String graphId, String action, [Map<String, dynamic>? body]) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/graphs/$graphId/agent/$action',
      data: body,
    );
    return res.data?['operation_id'] as String? ?? '';
  }

  // ── Operations ────────────────────────────────────────────

  Future<OperationStatus> getOperation(String opId) async {
    final res = await _dio.get<Map<String, dynamic>>('/operations/$opId');
    return OperationStatus.fromJson(res.data!);
  }

  Future<OperationStatus> cancelOperation(String opId) async {
    final res = await _dio.delete<Map<String, dynamic>>('/operations/$opId');
    return OperationStatus.fromJson(res.data!);
  }

  // ── SSE Stream ────────────────────────────────────────────

  Stream<Map<String, dynamic>> streamOperation(String opId) async* {
    final url = '${_dio.options.baseUrl}/operations/$opId/stream';
    final client = HttpClient();

    try {
      final request = await client.getUrl(Uri.parse(url));
      request.headers.set('Accept', 'text/event-stream');
      request.headers.set('Cache-Control', 'no-cache');

      final response = await request.close();
      final stream = response.transform(utf8.decoder).transform(const LineSplitter());

      String dataBuffer = '';
      String eventType = 'message';

      await for (final line in stream) {
        if (line.startsWith('event:')) {
          eventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          dataBuffer = line.substring(5).trim();
        } else if (line.isEmpty && dataBuffer.isNotEmpty) {
          try {
            final json = jsonDecode(dataBuffer) as Map<String, dynamic>;
            json['_event_type'] = eventType;
            yield json;
            if (eventType == 'done' || eventType == 'cancelled') break;
          } catch (_) {}
          dataBuffer = '';
          eventType = 'message';
        }
      }
    } finally {
      client.close();
    }
  }
}

// Needed for SSE implementation
import 'dart:io' show HttpClient;
