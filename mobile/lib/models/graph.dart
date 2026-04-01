import 'package:flutter/foundation.dart';

enum NodeStatus { unexplored, explored, expanded }
enum ContentDepth { shallow, medium, deep }
enum EdgeType { parentChild, crossDomain, prerequisite, related }

@immutable
class GraphMeta {
  const GraphMeta({
    required this.id,
    required this.name,
    required this.description,
    required this.nodeCount,
    required this.edgeCount,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String description;
  final int nodeCount;
  final int edgeCount;
  final String createdAt;
  final String updatedAt;

  factory GraphMeta.fromJson(Map<String, dynamic> j) => GraphMeta(
        id: j['id'] as String,
        name: j['name'] as String,
        description: j['description'] as String? ?? '',
        nodeCount: j['node_count'] as int? ?? 0,
        edgeCount: j['edge_count'] as int? ?? 0,
        createdAt: j['created_at'] as String? ?? '',
        updatedAt: j['updated_at'] as String? ?? '',
      );
}

@immutable
class NodeData {
  const NodeData({
    required this.id,
    required this.label,
    required this.description,
    required this.domain,
    required this.level,
    required this.status,
    required this.tags,
    required this.parentId,
    required this.hasDoc,
    required this.docSummary,
    required this.contentDepth,
  });

  final String id;
  final String label;
  final String description;
  final String domain;
  final int level;
  final NodeStatus status;
  final List<String> tags;
  final String? parentId;
  final bool hasDoc;
  final String docSummary;
  final ContentDepth contentDepth;

  factory NodeData.fromJson(Map<String, dynamic> j) => NodeData(
        id: j['id'] as String,
        label: j['label'] as String,
        description: j['description'] as String? ?? '',
        domain: j['domain'] as String? ?? '',
        level: j['level'] as int? ?? 0,
        status: _parseStatus(j['status'] as String?),
        tags: List<String>.from(j['tags'] as List? ?? []),
        parentId: j['parent_id'] as String?,
        hasDoc: j['has_doc'] as bool? ?? false,
        docSummary: j['doc_summary'] as String? ?? '',
        contentDepth: _parseDepth(j['content_depth'] as String?),
      );

  static NodeStatus _parseStatus(String? s) => switch (s) {
        'explored' => NodeStatus.explored,
        'expanded' => NodeStatus.expanded,
        _ => NodeStatus.unexplored,
      };

  static ContentDepth _parseDepth(String? s) => switch (s) {
        'medium' => ContentDepth.medium,
        'deep' => ContentDepth.deep,
        _ => ContentDepth.shallow,
      };
}

@immutable
class EdgeData {
  const EdgeData({
    required this.id,
    required this.sourceId,
    required this.targetId,
    required this.edgeType,
    required this.label,
  });

  final String id;
  final String sourceId;
  final String targetId;
  final EdgeType edgeType;
  final String label;

  factory EdgeData.fromJson(Map<String, dynamic> j) => EdgeData(
        id: j['id'] as String,
        sourceId: j['source_id'] as String,
        targetId: j['target_id'] as String,
        edgeType: _parseType(j['edge_type'] as String?),
        label: j['label'] as String? ?? '',
      );

  static EdgeType _parseType(String? s) => switch (s) {
        'cross_domain' => EdgeType.crossDomain,
        'prerequisite' => EdgeType.prerequisite,
        'related' => EdgeType.related,
        _ => EdgeType.parentChild,
      };
}

@immutable
class GraphDetail extends GraphMeta {
  const GraphDetail({
    required super.id,
    required super.name,
    required super.description,
    required super.nodeCount,
    required super.edgeCount,
    required super.createdAt,
    required super.updatedAt,
    required this.nodes,
    required this.edges,
    required this.rootNodeId,
  });

  final Map<String, NodeData> nodes;
  final Map<String, EdgeData> edges;
  final String? rootNodeId;

  factory GraphDetail.fromJson(Map<String, dynamic> j) {
    final graphData = j['graph_data'] as Map<String, dynamic>? ?? {};
    final rawNodes = graphData['nodes'] as Map<String, dynamic>? ?? {};
    final rawEdges = graphData['edges'] as Map<String, dynamic>? ?? {};

    return GraphDetail(
      id: j['id'] as String,
      name: j['name'] as String,
      description: j['description'] as String? ?? '',
      nodeCount: j['node_count'] as int? ?? 0,
      edgeCount: j['edge_count'] as int? ?? 0,
      createdAt: j['created_at'] as String? ?? '',
      updatedAt: j['updated_at'] as String? ?? '',
      nodes: rawNodes.map((k, v) => MapEntry(k, NodeData.fromJson(v as Map<String, dynamic>))),
      edges: rawEdges.map((k, v) => MapEntry(k, EdgeData.fromJson(v as Map<String, dynamic>))),
      rootNodeId: graphData['root_node_id'] as String?,
    );
  }

  List<String> childrenOf(String nodeId) => edges.values
      .where((e) => e.edgeType == EdgeType.parentChild && e.sourceId == nodeId)
      .map((e) => e.targetId)
      .toList();

  List<String> get rootIds {
    if (rootNodeId != null) return [rootNodeId!];
    return nodes.values.where((n) => n.parentId == null).map((n) => n.id).toList();
  }

  int get unexploredCount =>
      nodes.values.where((n) => n.status == NodeStatus.unexplored).length;

  int get noDocCount => nodes.values
      .where((n) => n.status != NodeStatus.unexplored && !n.hasDoc && n.level >= 1)
      .length;
}

@immutable
class OperationStatus {
  const OperationStatus({
    required this.operationId,
    required this.graphId,
    required this.operationType,
    required this.status,
    this.result,
    this.durationSeconds,
    this.turns,
    this.toolCalls,
    this.error,
  });

  final String operationId;
  final String graphId;
  final String operationType;
  final String status;
  final String? result;
  final double? durationSeconds;
  final int? turns;
  final int? toolCalls;
  final String? error;

  bool get isRunning => status == 'running' || status == 'pending';
  bool get isFinished => status == 'completed' || status == 'cancelled' || status == 'failed';

  factory OperationStatus.fromJson(Map<String, dynamic> j) => OperationStatus(
        operationId: j['operation_id'] as String,
        graphId: j['graph_id'] as String,
        operationType: j['operation_type'] as String? ?? '',
        status: j['status'] as String,
        result: j['result'] as String?,
        durationSeconds: (j['duration_seconds'] as num?)?.toDouble(),
        turns: j['turns'] as int?,
        toolCalls: j['tool_calls'] as int?,
        error: j['error'] as String?,
      );
}
