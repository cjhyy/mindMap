"""Multi-graph file management service."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from uuid import uuid4

from app.config import DATA_DIR
from tools.models import KnowledgeGraph, _now_iso

# Regex for valid graph IDs (8 hex chars only)
_GRAPH_ID_PATTERN = re.compile(r'^[a-f0-9]{8}$')


class GraphMeta:
    """Lightweight graph metadata (no full graph data)."""

    def __init__(self, id: str, name: str, description: str,
                 node_count: int, edge_count: int,
                 created_at: str, updated_at: str):
        self.id = id
        self.name = name
        self.description = description
        self.node_count = node_count
        self.edge_count = edge_count
        self.created_at = created_at
        self.updated_at = updated_at


def _validate_graph_id(graph_id: str) -> None:
    """Validate graph_id to prevent path traversal attacks."""
    if not _GRAPH_ID_PATTERN.match(graph_id):
        raise ValueError(f"Invalid graph_id: '{graph_id}'. Must be 8 hex characters.")


def _atomic_write(path: Path, content: str) -> None:
    """Write file atomically: write to temp, then rename. Prevents corruption."""
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


class GraphService:
    """Manages multiple knowledge graphs stored as individual JSON files."""

    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._index_lock = threading.Lock()

    def get_graph_path(self, graph_id: str) -> Path:
        _validate_graph_id(graph_id)
        return self.data_dir / f"{graph_id}.json"

    def create_graph(self, name: str, description: str = "") -> GraphMeta:
        if not name or len(name) > 200:
            raise ValueError("Graph name must be 1-200 characters")

        graph_id = uuid4().hex[:8]
        graph = KnowledgeGraph(name=name, description=description)
        path = self.get_graph_path(graph_id)
        graph.save(path)

        meta = GraphMeta(
            id=graph_id, name=name, description=description,
            node_count=0, edge_count=0,
            created_at=graph.created_at, updated_at=graph.updated_at,
        )
        self._save_meta(graph_id, meta)
        return meta

    def list_graphs(self) -> list[GraphMeta]:
        meta_path = self.data_dir / "_index.json"
        if not meta_path.exists():
            return []
        try:
            index = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        result = []
        for gid, m in index.items():
            result.append(GraphMeta(
                id=gid, name=m["name"], description=m.get("description", ""),
                node_count=m.get("node_count", 0), edge_count=m.get("edge_count", 0),
                created_at=m.get("created_at", ""), updated_at=m.get("updated_at", ""),
            ))
        result.sort(key=lambda g: g.updated_at, reverse=True)
        return result

    def get_graph(self, graph_id: str) -> KnowledgeGraph | None:
        _validate_graph_id(graph_id)
        path = self.get_graph_path(graph_id)
        if not path.exists():
            return None
        return KnowledgeGraph.load(path)

    def delete_graph(self, graph_id: str) -> bool:
        _validate_graph_id(graph_id)
        path = self.get_graph_path(graph_id)
        if not path.exists():
            return False
        path.unlink()
        self._remove_meta(graph_id)
        return True

    def update_meta_from_graph(self, graph_id: str) -> None:
        """Refresh metadata index from the actual graph file."""
        _validate_graph_id(graph_id)
        graph = self.get_graph(graph_id)
        if not graph:
            return
        meta = GraphMeta(
            id=graph_id, name=graph.name, description=graph.description,
            node_count=len(graph.nodes), edge_count=len(graph.edges),
            created_at=graph.created_at, updated_at=_now_iso(),
        )
        self._save_meta(graph_id, meta)

    def _save_meta(self, graph_id: str, meta: GraphMeta) -> None:
        """Save metadata atomically with lock to prevent concurrent corruption."""
        with self._index_lock:
            meta_path = self.data_dir / "_index.json"
            index = {}
            if meta_path.exists():
                try:
                    index = json.loads(meta_path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    index = {}
            index[graph_id] = {
                "name": meta.name, "description": meta.description,
                "node_count": meta.node_count, "edge_count": meta.edge_count,
                "created_at": meta.created_at, "updated_at": meta.updated_at,
            }
            _atomic_write(meta_path, json.dumps(index, ensure_ascii=False, indent=2))

    def _remove_meta(self, graph_id: str) -> None:
        """Remove metadata atomically with lock."""
        with self._index_lock:
            meta_path = self.data_dir / "_index.json"
            if not meta_path.exists():
                return
            try:
                index = json.loads(meta_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return
            index.pop(graph_id, None)
            _atomic_write(meta_path, json.dumps(index, ensure_ascii=False, indent=2))


graph_service = GraphService()
