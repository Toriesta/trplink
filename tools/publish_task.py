"""发布一条任务到 tasks.json（本地），或直接提交到 GitHub 仓库。

本地：  python tools/publish_task.py --title "第 16 集粗剪" --reward 400 --deadline 2026-11-25
远程：  set GH_TOKEN=github_pat_xxx
        python tools/publish_task.py --title "..." --reward 400 --repo owner/trp-tasks --push

只依赖标准库；tasks.json 的 id 形如 T-2611-05（年月 + 序号）。
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS = ROOT / "tasks.json"
API = "https://api.github.com"


def load() -> dict:
    if TASKS.exists():
        return json.loads(TASKS.read_text(encoding="utf-8"))
    return {"updated": "", "tasks": []}


def next_id(tasks: list[dict]) -> str:
    base = dt.date.today().strftime("%y%m")
    seq = 1
    used = {str(t.get("id") or "") for t in tasks}
    while f"T-{base}-{seq:02d}" in used:
        seq += 1
    return f"T-{base}-{seq:02d}"


def make_task(args) -> dict:
    return {
        "id": "",
        "title": args.title.strip(),
        "brief": (args.brief or "").strip(),
        "desc": (args.desc or "").strip(),
        "reward": float(args.reward or 0),
        "deadline": args.deadline or "",
        "priority": int(args.priority or 2),
        "tags": [t.strip() for t in (args.tags or "").split(",") if t.strip()],
        "status": "open",
        "claimedBy": "",
        "claimedAt": "",
        "submittedAt": "",
        "checklist": [c.strip() for c in (args.checklist or "").split("|") if c.strip()],
    }


def push_github(repo: str, token: str, data: dict, branch: str = "main", path: str = "tasks.json"):
    url = f"{API}/repos/{repo}/contents/{path}?ref={branch}"
    headers = {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"}
    sha = ""
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            sha = json.loads(r.read().decode("utf-8")).get("sha", "")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    body = {
        "message": f"publish task: {data['tasks'][-1]['title'][:40]}",
        "content": base64.b64encode(
            (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode(),
        "branch": branch,
    }
    if sha:
        body["sha"] = sha
    req = urllib.request.Request(
        f"{API}/repos/{repo}/contents/{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")).get("content", {}).get("sha", "")


def main() -> int:
    ap = argparse.ArgumentParser(description="发布一条任务")
    ap.add_argument("--title", required=True)
    ap.add_argument("--reward", type=float, default=0)
    ap.add_argument("--deadline", default="", help="YYYY-MM-DD")
    ap.add_argument("--priority", type=int, default=2, choices=[1, 2, 3])
    ap.add_argument("--brief", default="")
    ap.add_argument("--desc", default="")
    ap.add_argument("--tags", default="", help="逗号分隔")
    ap.add_argument("--checklist", default="", help="竖线分隔")
    ap.add_argument("--repo", default="", help="owner/repo，给了就提交到 GitHub")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--push", action="store_true", help="提交到 GitHub（需要 GH_TOKEN）")
    args = ap.parse_args()

    data = load()
    task = make_task(args)
    task["id"] = next_id(data["tasks"])
    data["tasks"].append(task)
    data["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")

    TASKS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入 {TASKS.name}：{task['id']} {task['title']}")

    if args.push:
        token = os.environ.get("GH_TOKEN", "").strip()
        if not token:
            print("缺少 GH_TOKEN 环境变量，已只写本地文件", file=sys.stderr)
            return 1
        if not args.repo:
            print("--push 需要同时给 --repo owner/name", file=sys.stderr)
            return 1
        sha = push_github(args.repo, token, data, args.branch)
        print(f"已提交到 {args.repo}（sha {sha[:8]}），手机端刷新即可看到")
    return 0


if __name__ == "__main__":
    sys.exit(main())
