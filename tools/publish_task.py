"""发布任务（仅管理员），可指定接单人。

本地：  python tools/publish_task.py --admin 你的微信号 --title "第 16 集粗剪" --reward 400 --deadline 2026-11-25
指派：  python tools/publish_task.py --admin 你的微信号 --title "..." --assign-to chenchengfang --assign-name 陈成方
录入人才：python tools/publish_task.py --admin 你的微信号 --add-worker chenchengfang --worker-name 陈成方
首次：  python tools/publish_task.py --admin 你的微信号 --set-admin
推仓库：再加 --repo Toriesta/trplink --push（需 GH_TOKEN 环境变量）

config.json 里的 adminWechat 是唯一允许发布的人；普通手机端没有发布入口，
写入时还会再校验一次「只能接 open 或指派给自己的单、只能提交自己的单」。
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
PRIVATE = ROOT / "tasks-private.json"   # A 级：只在本机，永不进仓库
USERS = ROOT / "users.json"
CONFIG = ROOT / "config.json"
API = "https://api.github.com"


def load_json(path: Path, fallback: dict) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return fallback


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def next_id(tasks: list[dict]) -> str:
    base = dt.date.today().strftime("%y%m")
    seq = 1
    used = {str(t.get("id") or "") for t in tasks}
    while f"T-{base}-{seq:02d}" in used:
        seq += 1
    return f"T-{base}-{seq:02d}"


def push_github(repo: str, token: str, data: dict, branch: str,
                path: str, message: str) -> str:
    headers = {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"}
    url = f"{API}/repos/{repo}/contents/{path}"
    sha = ""
    try:
        req = urllib.request.Request(f"{url}?ref={branch}", headers=headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            sha = json.loads(r.read().decode("utf-8")).get("sha", "")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    body = {
        "message": message,
        "content": base64.b64encode(
            (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode(),
        "branch": branch,
    }
    if sha:
        body["sha"] = sha
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")).get("content", {}).get("sha", "")


def main() -> int:
    ap = argparse.ArgumentParser(description="管理员发布 / 指派任务")
    ap.add_argument("--admin", required=True, help="你的微信号，用于管理员校验")
    ap.add_argument("--set-admin", action="store_true", help="首次把 --admin 写成管理员")
    ap.add_argument("--title")
    ap.add_argument("--reward", type=float, default=0)
    ap.add_argument("--deadline", default="", help="YYYY-MM-DD")
    ap.add_argument("--priority", type=int, default=2, choices=[1, 2, 3])
    ap.add_argument("--brief", default="")
    ap.add_argument("--desc", default="")
    ap.add_argument("--tags", default="", help="逗号分隔")
    ap.add_argument("--checklist", default="", help="竖线分隔")
    ap.add_argument("--assign-to", default="", help="指定接单人的微信号")
    ap.add_argument("--assign-name", default="", help="指定接单人的显示名")
    ap.add_argument("--add-worker", default="", help="把微信号录入人才库（不发布任务）")
    ap.add_argument("--worker-name", default="", help="录入人才时的显示名")
    ap.add_argument("--trust-worker", default="", help="把成员升为可信（可见 B 级）")
    ap.add_argument("--untrust-worker", default="", help="取消可信身份")
    ap.add_argument("--secret", default="A", choices=["A", "B", "C"],
                    help="保密等级：A 只留本机、B 仅可信成员、C 任何人可接（默认 A）")
    ap.add_argument("--craft", type=int, default=5, choices=list(range(0, 11)),
                    help="制作水平 0–10，默认 5；与保密等级合成 A5 这样的编码")
    ap.add_argument("--craft-max", type=int, default=0, choices=list(range(0, 11)),
                    help="录入/授权人才时：此人能做的最高制作水平（0–10）")
    ap.add_argument("--repo", default="", help="owner/repo，给了就提交到 GitHub")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--push", action="store_true", help="提交到 GitHub（需要 GH_TOKEN）")
    args = ap.parse_args()

    cfg = load_json(CONFIG, {"adminWechat": "", "users": []})
    admin = args.admin.strip()

    # 管理员身份：只有 config.json 里登记的微信号能发布
    if args.set_admin:
        cfg["adminWechat"] = admin
        save_json(CONFIG, cfg)
        print(f"已把 {admin} 设为唯一管理员")
        return 0
    configured = str(cfg.get("adminWechat") or "").strip()
    if not configured:
        print("还没设置管理员，先运行：python tools/publish_task.py --admin 你的微信号 --set-admin",
              file=sys.stderr)
        return 1
    if admin != configured:
        print(f"{admin} 不是管理员，只有 {configured} 能发布任务", file=sys.stderr)
        return 1

    # 人才库：被动注册。只有管理员在这里录过的微信号，手机端才能登录
    if args.add_worker:
        wx = args.add_worker.strip()
        users_data = load_json(USERS, {"updated": "", "users": []})
        if not users_data.get("users"):
            users_data["users"] = []
        hit = next((u for u in users_data["users"]
                    if str(u.get("wechat") or "").strip() == wx), None)
        if hit is None:
            hit = {"wechat": wx, "name": args.worker_name or wx,
                   "role": "worker", "trusted": False,
                   "craft_max": args.craft_max or 5,
                   "registeredAt": dt.date.today().isoformat()}
            users_data["users"].append(hit)
        else:
            hit["name"] = args.worker_name or hit.get("name") or wx
            hit["role"] = "worker"
            if args.craft_max:
                hit["craft_max"] = args.craft_max
        users_data["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        save_json(USERS, users_data)
        print(f"已录入人才库：{wx}（{hit['name']}），手机端现在可以用这个微信号登录")
        if args.push:
            token = os.environ.get("GH_TOKEN", "").strip()
            if not token or not args.repo:
                print("推送需要 GH_TOKEN 和 --repo，已只写本地文件", file=sys.stderr)
                return 1
            push_github(args.repo, token, users_data, args.branch, "users.json",
                        f"add worker {wx}")
        return 0

    # 可信身份：B 级任务只对这些人可见、可接
    if args.trust_worker or args.untrust_worker:
        wx = (args.trust_worker or args.untrust_worker).strip()
        flag = bool(args.trust_worker)
        users_data = load_json(USERS, {"updated": "", "users": []})
        if not users_data.get("users"):
            users_data["users"] = []
        hit = next((u for u in users_data["users"]
                    if str(u.get("wechat") or "").strip() == wx), None)
        if hit is None:
            if not flag:
                print(f"人才库里没有 {wx}", file=sys.stderr)
                return 1
            hit = {"wechat": wx, "name": args.worker_name or wx,
                   "role": "worker", "craft_max": args.craft_max or 5,
                   "registeredAt": dt.date.today().isoformat()}
            users_data["users"].append(hit)
        hit["trusted"] = flag
        if args.worker_name:
            hit["name"] = args.worker_name
        if args.craft_max:
            hit["craft_max"] = args.craft_max
        users_data["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        save_json(USERS, users_data)
        print(f"{wx} " + ("已升为可信成员（可见并接 B 级）" if flag else "已取消可信（只接 C 级）"))
        if args.push:
            token = os.environ.get("GH_TOKEN", "").strip()
            if not token or not args.repo:
                print("推送需要 GH_TOKEN 和 --repo，已只写本地文件", file=sys.stderr)
                return 1
            push_github(args.repo, token, users_data, args.branch, "users.json",
                        f"trust {wx}={flag}")
        return 0

    if not args.title:
        print("发布任务需要 --title", file=sys.stderr)
        return 1

    secret = (args.secret or "A").upper()
    if secret not in ("A", "B", "C"):
        secret = "A"
    if secret == "A":
        # A 级永不进共享仓库：只在管理员本机留档
        if args.assign_to:
            print("A 级任务必须自己做，不能指派给任何人", file=sys.stderr)
            return 1
        if args.push:
            print("A 级任务不能推到共享仓库（会泄露），只写本机 tasks-private.json",
                  file=sys.stderr)
            return 1
        target = PRIVATE
    else:
        target = TASKS

    tasks_data = load_json(target, {"updated": "", "tasks": []})
    users_data = load_json(USERS, {"updated": "", "users": []})
    if not users_data.get("users"):
        users_data["users"] = []

    task = {
        "id": next_id(tasks_data["tasks"]),
        "title": args.title.strip(),
        "brief": (args.brief or "").strip(),
        "desc": (args.desc or "").strip(),
        "reward": float(args.reward or 0),
        "deadline": args.deadline or "",
        "priority": int(args.priority or 2),
        "tags": [t.strip() for t in (args.tags or "").split(",") if t.strip()],
        "secret": secret,
        "craft": int(args.craft),
        "assignedTo": (args.assign_to or "").strip(),
        "status": "open",
        "claimedBy": "",
        "claimedName": "",
        "claimedAt": "",
        "submittedAt": "",
        "checklist": [c.strip() for c in (args.checklist or "").split("|") if c.strip()],
    }

    # 指定人 = 直接派单：对方打开就是「我的任务」，不用抢
    if task["assignedTo"]:
        wx = task["assignedTo"]
        hit = next((u for u in users_data["users"]
                    if str(u.get("wechat") or "").strip() == wx), None)
        if hit is None:
            if secret == "B":
                print(f"B 级任务只能派给可信成员：先运行 --trust-worker {wx} 授权",
                      file=sys.stderr)
                return 1
            hit = {"wechat": wx, "name": args.assign_name or wx,
                   "role": "worker", "craft_max": args.craft_max or 5,
                   "registeredAt": dt.date.today().isoformat()}
            users_data["users"].append(hit)
        elif secret == "B" and not hit.get("trusted"):
            print(f"{wx} 还不可信，B 级任务不能派给他：先 --trust-worker {wx}",
                  file=sys.stderr)
            return 1

        need = int(task["craft"])
        have = int(hit.get("craft_max") if hit.get("craft_max") is not None else 5)
        if need > have:
            print(f"{wx} 的制作水平上限是 {have}，这单是 {secret}{need}；"
                  f"先 --craft-max {need} 授权，或换一个人", file=sys.stderr)
            return 1

        task["status"] = "claimed"
        task["claimedBy"] = wx
        task["claimedName"] = hit.get("name") or wx
        task["claimedAt"] = dt.date.today().isoformat()
        users_data["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")

    tasks_data["tasks"].append(task)
    tasks_data["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")

    save_json(target, tasks_data)
    if task["assignedTo"]:
        save_json(USERS, users_data)

    who = "指派给 " + task["assignedTo"] if task["assignedTo"] else "公开抢单"
    print(f"已发布 {task['id']} {task['title']}（等级 {secret}{task['craft']} · {who}）")
    if secret == "A":
        print(f"  已写入 {PRIVATE.name}，只在本机，不会同步到 GitHub")

    if args.push:
        token = os.environ.get("GH_TOKEN", "").strip()
        if not token:
            print("缺少 GH_TOKEN 环境变量，已只写本地文件", file=sys.stderr)
            return 1
        if not args.repo:
            print("--push 需要同时给 --repo owner/name", file=sys.stderr)
            return 1
        push_github(args.repo, token, tasks_data, args.branch, "tasks.json",
                    f"publish {task['id']}: {task['title'][:36]}")
        if task["assignedTo"]:
            push_github(args.repo, token, users_data, args.branch, "users.json",
                        f"register {task['assignedTo']}")
        print(f"已提交到 {args.repo}，手机端刷新即可看到")
    return 0


if __name__ == "__main__":
    sys.exit(main())
