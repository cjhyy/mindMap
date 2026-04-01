"""FastAPI backend for Knowledge MindMap Agent."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure project root (mindMap/) is importable
PROJECT_DIR = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(PROJECT_DIR))

# Load .env
env_file = PROJECT_DIR / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())

import logging

# ── Logging setup ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
# Quiet noisy libs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routers import agent, chat, graphs, markdown, nodes

app = FastAPI(
    title="Knowledge MindMap API",
    description="AI-powered knowledge graph builder with interrupt/resume support",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(graphs.router)
app.include_router(nodes.router)
app.include_router(markdown.router)
app.include_router(agent.router)


@app.get("/")
async def root():
    return {
        "name": "Knowledge MindMap API",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
