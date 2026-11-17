"""一键同步：把可共享的数据与代码推到 GitHub。

共享边界（写死，不靠自觉）：
  可以共享：tasks.json（B/C 级任务）、users.json（人才库）、config.json（管理员）、
            www/（前端）、tools/、docs/、android/、构造文件
  绝不共享：tasks-private.json（A 级任务）、node_modules/、构建产物、*.apk、local.properties

每次同步前会做三件事：JSON 合法性校验 → A 级任务拦截 → 密钥/令牌扫描。
任何一项不通过就中止，不会推出去。

用法：
  python tools/sync_github.py             # 检查 + 提交 + 推送
  python tools/sync_github.py --dry-run   # 只检查，列出将要提交的文件
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED_DIRS = ("www", "tools", "docs", "android", ".github")
SHARED_FILES = (
    "tasks.json", "users.json", "config.json", "README.md",
    "package.json", "package-lock.json", "capacitor.config.json", ".gitignore",
    "同步到GitHub.bat",
)
TEXT_SUFFIX = {".js", ".json", ".py", ".bat", ".cmd", ".md", ".css", ".html",
               ".xml", ".gradle", ".yml", ".yaml", ".txt", ".java", ".kt", ".properties"}
SENSITIVE = (
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "GitHub 细粒度令牌"),
    (re.compile(r"ghp_[A-Za-z0-9]{30,}"), "GitHub 个人令牌"),
    (re.compile(r"sk-[A-Za-z0-9]{20,}"), "模型 API Key"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS Access Key"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "私钥文件内容"),
    (re.compile(r"(?i)(password|passwd)\s*[:=]\s*['\"][^'\"]{6,}"), "明文密码"),
)

ok_count = 0
warn: list[str] = []


def say(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    # core.quotepath=false：中文文件名原样显示，而不是 \345\220\214
    r = subprocess.run(["git", "-c", "core.quotepath=false", *args],
                       cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "git 执行失败").strip())
    return r


def shared_paths() -> list[str]:
    paths = [p for p in SHARED_FILES if (ROOT / p).exists()]
    paths += [d for d in SHARED_DIRS if (ROOT / d).is_dir()]
    return paths


# ---------------------------------------------------------------- 校验
def check_json() -> None:
    """三个数据文件必须可解析，且 A 级任务不得进入共享池。"""
    global ok_count

    tasks_path = ROOT / "tasks.json"
    data = json.loads(tasks_path.read_text(encoding="utf-8"))
    tasks = data.get("tasks")
    if not isinstance(tasks, list):
        raise RuntimeError("tasks.json 结构不对：缺少 tasks 数组")
    bad_a = [t.get("id") or "(无编号)" for t in tasks
             if str(t.get("secret") or "C").upper() == "A"]
    if bad_a:
        raise RuntimeError(
            "发现 A 级任务在共享池里：" + "、".join(bad_a) +
            "\n       A 级只能留在本机 tasks-private.json，请先移出去再同步")
    bad_lv = [t.get("id") for t in tasks
              if str(t.get("secret") or "C").upper() not in ("A", "B", "C")]
    if bad_lv:
        raise RuntimeError(f"这些任务的 secret 不是 A/B/C：{bad_lv}")
    say("OK", f"tasks.json 合法：{len(tasks)} 条，"
              f"B 级 {sum(1 for t in tasks if str(t.get('secret') or 'C').upper() == 'B')} 条，"
              f"C 级 {sum(1 for t in tasks if str(t.get('secret') or 'C').upper() == 'C')} 条")
    ok_count += 1

    users_path = ROOT / "users.json"
    users_data = json.loads(users_path.read_text(encoding="utf-8"))
    users = users_data.get("users")
    if not isinstance(users, list):
        raise RuntimeError("users.json 结构不对：缺少 users 数组")
    no_wx = [u.get("name") or "?" for u in users if not str(u.get("wechat") or "").strip()]
    if no_wx:
        raise RuntimeError(f"这些成员缺微信号：{no_wx}")
    bad_role = [u.get("wechat") for u in users if u.get("role") not in ("admin", "worker")]
    if bad_role:
        raise RuntimeError(f"这些成员 role 不是 admin/worker：{bad_role}")
    admin_n = sum(1 for u in users if u.get("role") == "admin")
    trusted_n = sum(1 for u in users if u.get("trusted"))
    say("OK", f"users.json 合法：{len(users)} 人 · 管理员 {admin_n} · 可信 {trusted_n}")
    if admin_n == 0:
        warn.append("人才库里没有管理员，手机端没人能发布任务")
    ok_count += 1

    cfg_path = ROOT / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    admin = str(cfg.get("adminWechat") or "").strip()
    if not admin:
        raise RuntimeError("config.json 的 adminWechat 为空：所有发布都会被拒，先填管理员微信号")
    if admin not in {str(u.get("wechat") or "") for u in users}:
        warn.append(f"管理员 {admin} 不在 users.json 里，手机端不会显示这条身份")
    say("OK", f"config.json 合法：管理员 {admin}")
    ok_count += 1


def changed_files() -> list[Path]:
    out = run(["status", "--porcelain"]).stdout.splitlines()
    files = []
    for line in out:
        path = line[3:].strip()
        if not path or line[:2].strip().startswith("D"):
            continue
        if " -> " in path:          # 重命名：取新路径
            path = path.split(" -> ")[-1]
        files.append(Path(path.strip('"')))
    return files


def scan_sensitive(files: list[Path]) -> None:
    """只扫将要提交的文本文件，发现令牌/私钥就中止。"""
    hits: list[str] = []
    for rel in files:
        p = ROOT / rel
        if not p.is_file() or p.suffix.lower() not in TEXT_SUFFIX:
            continue
        try:
            if p.stat().st_size > 2 * 1024 * 1024:
                continue
            raw = p.read_bytes()
            if b"\0" in raw[:4096]:
                continue
            text = raw.decode("utf-8", "replace")
        except OSError:
            continue
        for pattern, label in SENSITIVE:
            m = pattern.search(text)
            if m:
                hits.append(f"{rel} 里有疑似{label}（{m.group(0)[:12]}…）")
    if hits:
        raise RuntimeError("安全扫描未通过，已中止：\n       " + "\n       ".join(hits))
    say("OK", f"安全扫描通过：检查了 {len(files)} 个待提交文件，没有令牌/私钥/明文密码")


def forbid_private() -> None:
    """A 级文件绝不能被 git 跟踪。"""
    tracked = run(["ls-files"]).stdout.splitlines()
    if any(t.endswith("tasks-private.json") for t in tracked):
        raise RuntimeError("tasks-private.json 已被 git 跟踪——先执行 "
                           "git rm --cached tasks-private.json")
    if any(t.endswith(".apk") for t in tracked):
        raise RuntimeError("有 APK 被跟踪了，构建产物不进仓库")
    say("OK", "隐私文件未被跟踪（tasks-private.json / *.apk 均不在 git 里）")


# ---------------------------------------------------------------- 推送
def commit_and_push(dry: bool) -> int:
    global ok_count
    staged = run(["diff", "--cached", "--name-only"]).stdout.strip()
    if not staged:
        say("--", "没有文件变化，跳过提交")
    else:
        files = [ln for ln in staged.splitlines() if ln]
        say("OK", f"本次提交 {len(files)} 个文件：")
        for f in files[:12]:
            print(f"       · {f}")
        if len(files) > 12:
            print(f"       · ……另外 {len(files) - 12} 个")
        if dry:
            say("--", "dry-run：不提交")
            return 0
        stamp = time.strftime("%Y-%m-%d %H:%M")
        run([
            "-c", "user.name=Toriesta",
            "-c", "user.email=Toriesta@users.noreply.github.com",
            "commit", "-m", f"sync: 人才库与任务数据 {stamp}",
        ])
        say("OK", "已提交 " + run(["rev-parse", "--short", "HEAD"]).stdout.strip())
        ok_count += 1

    if dry:
        return 0

    branch = run(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip() or "main"
    for attempt in range(1, 4):
        r = run(["push", "origin", branch], check=False)
        if r.returncode == 0:
            say("OK", f"已推送到 origin/{branch}")
            ok_count += 1
            return 0
        err = (r.stderr or r.stdout or "").strip()
        if "non-fast-forward" in err or "rejected" in err or "fetch first" in err:
            say("!!", "远端有新提交，先拉取再重推")
            pr = run(["pull", "--rebase", "origin", branch], check=False)
            if pr.returncode != 0:
                raise RuntimeError("拉取失败（可能有冲突，需手动处理）：\n       " +
                                   (pr.stderr or "").strip())
            continue
        say("!!", f"第 {attempt} 次推送失败：{err.splitlines()[0] if err else '未知原因'}")
        if attempt < 3:
            time.sleep(5)
    raise RuntimeError("推送失败：网络连不上 github.com，恢复后再双击一次即可（本地提交已保留）")


def main() -> int:
    ap = argparse.ArgumentParser(description="把可共享的数据推到 GitHub")
    ap.add_argument("--dry-run", action="store_true", help="只检查，不提交")
    args = ap.parse_args()

    print()
    print("  TRP 任务台 · 同步到 GitHub")
    print("  " + "-" * 44)

    if not (ROOT / ".git").exists():
        say("XX", f"{ROOT} 不是 git 仓库")
        return 1
    remote = run(["remote", "get-url", "origin"], check=False)
    if remote.returncode != 0:
        say("XX", "没有配置 origin 远程仓库")
        return 1
    say("OK", "仓库：" + remote.stdout.strip())

    try:
        check_json()
        forbid_private()
        run(["add", "--", *shared_paths()])
        files = changed_files()
        scan_sensitive(files)
        commit_and_push(args.dry_run)
        if args.dry_run:
            run(["reset", "-q", "--", *shared_paths()], check=False)
            say("--", "dry-run：已取消暂存，工作区未改动")
    except RuntimeError as e:
        run(["reset", "-q"], check=False)   # 中止时不要留下暂存，尤其是敏感文件
        print()
        say("XX", "已中止：" + str(e))
        return 1
    except Exception as e:  # noqa: BLE001
        print()
        say("XX", f"意外错误：{type(e).__name__}: {e}")
        return 1

    print()
    for w in warn:
        say("!!", w)
    print(f"  完成 {ok_count} 项检查/操作")
    print("  手机端：下拉或点右上角刷新即可看到最新任务")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
