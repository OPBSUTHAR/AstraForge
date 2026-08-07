"""AstraForge Karmashala CLI — terminal AI brain (Phase 1).

A local, Ollama-powered command interface over the AstraForge workspace.
It classifies natural-language commands, then drives the backend API or
(Phase 2) the vision/geometry services.

    python cli.py "generate mesh from asset abc12345"
    python cli.py --interactive

Requires:
    - Ollama running at OLLAMA_HOST with a llama3 model (OLLAMA_MODEL)
    - AstraForge web server on Astraforge server port (default 4000)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

SERVER = os.environ.get("ASTRAFORGE_API_URL", "http://localhost:4000/api")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")

INTENT_LABELS = [
    "status",
    "list-projects",
    "list-assets",
    "vision",
    "geometry-split",
    "help",
    "unknown",
]

SYSTEM_PROMPT = (
    "You are Karmashala, the terminal AI for AstraForge, a holographic 3D design "
    "and fabrication workspace. Classify the user's command into exactly one label "
    f"from {INTENT_LABELS}. Reply with only the label, no extra text."
)


def post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"content-type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode())


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=8) as res:
        return json.loads(res.read().decode())


def classify(text: str) -> str:
    try:
        body = post(
            f"{OLLAMA_HOST}/api/chat",
            {
                "model": OLLAMA_MODEL,
                "stream": False,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": text}],
            },
        )
        label = body.get("message", {}).get("content", "").strip().lower()
        if label in INTENT_LABELS:
            return label
        print(f"[karmashala] ollama returned '{label}'; falling back to keywords")
    except Exception as exc:
        print(f"[karmashala] ollama offline ({exc}); keyword classification")
    return keyword_classify(text)


def keyword_classify(text: str) -> str:
    lower = text.lower()
    if any(k in lower for k in ("split", "cut", "slice", "part", "joint", "segment", "lego")):
        return "geometry-split"
    if any(k in lower for k in ("mesh", "3d", "generate", "model", "image", "photo")):
        return "vision"
    if "project" in lower:
        return "list-projects"
    if "asset" in lower or "file" in lower:
        return "list-assets"
    if "status" in lower:
        return "status"
    return "help" if "help" in lower else "unknown"


def run(text: str) -> None:
    intent = classify(text)
    print(f"[karmash] intent={intent}")

    if intent == "status":
        print(json.dumps(get(f"{SERVER}/health"), indent=2))
    elif intent == "list-projects":
        print(json.dumps(get(f"{SERVER}/projects"), indent=2))
    elif intent == "list-assets":
        print(json.dumps(get(f"{SERVER}/assets"), indent=2))
    elif intent == "vision":
        run_vision(text)
    elif intent == "geometry-split":
        print("[karmash] geometry engine (C++) not wired in Phase 1")
    elif intent == "help":
        print("commands: status · list projects · list assets · "
              "generate mesh from asset <id> · split <model> into <n> parts")
    else:
        print(f"[karmash] unrecognized command: {text}")


def run_vision(text: str) -> None:
    import re

    match = re.search(r"asset\s+([0-9a-fA-F-]{8,})", text)
    if not match:
        print("[karmash] usage: 'generate mesh from asset <assetId>'")
        return
    job = post(f"{SERVER}/assets/{match.group(1)}/vision", {})
    print(f"[karmash] vision job queued: {job.get('id')} (watch UI for progress)")


def main() -> None:
    parser = argparse.ArgumentParser(prog="karmashala", description="AstraForge terminal AI")
    parser.add_argument("command", nargs="*", help="natural language command")
    parser.add_argument("-i", "--interactive", action="store_true", help="REPL loop")
    args = parser.parse_args()

    if args.interactive or not args.command:
        print("KARMASHALA › terminal AI · Ctrl-C to exit")
        while True:
            try:
                line = input("karmashala> ")
            except (KeyboardInterrupt, EOFError):
                print()
                break
            if not line.strip():
                continue
            run(line.strip())
    else:
        run(" ".join(args.command))


if __name__ == "__main__":
    sys.exit(main())