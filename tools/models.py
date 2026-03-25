"""Knowledge Graph data model for the MindMap Agent."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


class NodeStatus(str, Enum):
    UNEXPLORED = "unexplored"
    EXPLORED = "explored"
    EXPANDED = "expanded"


class EdgeType(str, Enum):
    PARENT_CHILD = "parent_child"
    CROSS_DOMAIN = "cross_domain"
    PREREQUISITE = "prerequisite"
    RELATED = "related"


def _short_id() -> str:
    return str(uuid.uuid4())[:8]


def _now_iso() -> str:
    return datetime.now().isoformat()


@dataclass
class KnowledgeNode:
    id: str = field(default_factory=_short_id)
    label: str = ""
    description: str = ""
    domain: str = ""
    level: int = 0
    status: NodeStatus = NodeStatus.UNEXPLORED
    tags: list[str] = field(default_factory=list)
    source_urls: list[str] = field(default_factory=list)
    parent_id: str | None = None
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> KnowledgeNode:
        d = dict(d)
        d["status"] = NodeStatus(d.get("status", "unexplored"))
        valid_fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in d.items() if k in valid_fields})


@dataclass
class KnowledgeEdge:
    id: str = field(default_factory=_short_id)
    source_id: str = ""
    target_id: str = ""
    edge_type: EdgeType = EdgeType.PARENT_CHILD
    label: str = ""
    weight: float = 1.0
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["edge_type"] = self.edge_type.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> KnowledgeEdge:
        d = dict(d)
        d["edge_type"] = EdgeType(d.get("edge_type", "parent_child"))
        valid_fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in d.items() if k in valid_fields})


@dataclass
class KnowledgeGraph:
    """Full knowledge graph with nodes, edges, and query helpers."""

    name: str = "Untitled Knowledge Map"
    description: str = ""
    nodes: dict[str, KnowledgeNode] = field(default_factory=dict)
    edges: dict[str, KnowledgeEdge] = field(default_factory=dict)
    root_node_id: str | None = None
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    # ── Query helpers ───────────────────────────────────────────

    def get_children(self, node_id: str) -> list[KnowledgeNode]:
        child_ids = {
            e.target_id
            for e in self.edges.values()
            if e.source_id == node_id and e.edge_type == EdgeType.PARENT_CHILD
        }
        return [self.nodes[cid] for cid in child_ids if cid in self.nodes]

    def get_parent(self, node_id: str) -> KnowledgeNode | None:
        node = self.nodes.get(node_id)
        if node and node.parent_id and node.parent_id in self.nodes:
            return self.nodes[node.parent_id]
        return None

    def get_connections(self, node_id: str) -> list[tuple[KnowledgeEdge, KnowledgeNode]]:
        results = []
        for e in self.edges.values():
            if e.source_id == node_id and e.target_id in self.nodes:
                results.append((e, self.nodes[e.target_id]))
            elif e.target_id == node_id and e.source_id in self.nodes:
                results.append((e, self.nodes[e.source_id]))
        return results

    def get_non_tree_connections(self, node_id: str) -> list[tuple[KnowledgeEdge, KnowledgeNode]]:
        return [
            (e, n)
            for e, n in self.get_connections(node_id)
            if e.edge_type != EdgeType.PARENT_CHILD
        ]

    def get_unexplored_nodes(self) -> list[KnowledgeNode]:
        return [n for n in self.nodes.values() if n.status == NodeStatus.UNEXPLORED]

    def find_nodes_by_label(self, keyword: str) -> list[KnowledgeNode]:
        kw = keyword.lower()
        return [n for n in self.nodes.values() if kw in n.label.lower()]

    def find_nodes_by_domain(self, domain: str) -> list[KnowledgeNode]:
        d = domain.lower()
        return [n for n in self.nodes.values() if d in n.domain.lower()]

    def get_domains(self) -> list[str]:
        return sorted({n.domain for n in self.nodes.values() if n.domain})

    def get_subtree_ids(self, node_id: str, max_depth: int = -1) -> list[str]:
        """BFS to collect all descendant node IDs."""
        result = [node_id]
        queue = [(node_id, 0)]
        while queue:
            current_id, depth = queue.pop(0)
            if max_depth >= 0 and depth >= max_depth:
                continue
            for child in self.get_children(current_id):
                result.append(child.id)
                queue.append((child.id, depth + 1))
        return result

    # ── Serialization ──────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "root_node_id": self.root_node_id,
            "created_at": self.created_at,
            "updated_at": _now_iso(),
            "nodes": {nid: n.to_dict() for nid, n in self.nodes.items()},
            "edges": {eid: e.to_dict() for eid, e in self.edges.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> KnowledgeGraph:
        g = cls(
            name=data.get("name", ""),
            description=data.get("description", ""),
            root_node_id=data.get("root_node_id"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )
        for nid, nd in data.get("nodes", {}).items():
            g.nodes[nid] = KnowledgeNode.from_dict(nd)
        for eid, ed in data.get("edges", {}).items():
            g.edges[eid] = KnowledgeEdge.from_dict(ed)
        return g

    # ── Persistence ─────────────────────────────────────────────

    def save(self, path: Path) -> None:
        data = self.to_dict()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> KnowledgeGraph:
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls.from_dict(data)
