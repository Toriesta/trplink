"""把本机令牌注入到 www/token.json（构建时用，永不提交）。

用法：
  python tools/inject_token.py            # 从 .token.json 读
  python tools/inject_token.py --clear    # 清掉内置令牌

安全：只应使用 fine-grained token，限定 trplink 仓库、Contents: read/write、90 天过期。
全权 gho_ 令牌一旦进 APK，别人解包就能操作你整个 GitHub 账号。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".token.json"
DST = ROOT / "www" / "token.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear", action="store_true")
    args = ap.parse_args()
    if args.clear:
        if DST.exists():
            DST.unlink()
        print("已清除内置令牌")
        return 0
    if not SRC.exists():
        print("缺少 .token.json：先运行获取令牌的步骤")
        return 1
    data = json.loads(SRC.read_text(encoding="utf-8"))
    tok = str(data.get("token") or "").strip()
    if not tok:
        print(".token.json 里没有 token")
        return 1
    DST.write_text(json.dumps({"token": tok}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"已注入内置令牌（长度 {len(tok)}）→ www/token.json")
    if tok.startswith("gho_") or tok.startswith("ghp_"):
        print("警告：这是全权经典令牌，拿到 APK 的人能操作你整个账号。")
        print("      正式分发前请换成 fine-grained token（仅 trplink / Contents 读写 / 90 天）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
