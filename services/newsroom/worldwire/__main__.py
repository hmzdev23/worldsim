"""CLI: python3 -m worldwire FIXTURE [--html OUT]

Prints the WORLD//WIRE feed as JSON, or writes a self-contained preview page.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .wire import derive_news

TEMPLATE = Path(__file__).resolve().parent.parent / "preview" / "template.html"
FEED_PLACEHOLDER = "/*__WORLDWIRE_FEED__*/[]"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="worldwire", description=__doc__)
    parser.add_argument("fixture", type=Path, help="event batch JSON with an 'events' array")
    parser.add_argument("--html", type=Path, help="write a preview page here instead of printing JSON")
    args = parser.parse_args(argv)

    batch = json.loads(args.fixture.read_text(encoding="utf-8"))
    feed = derive_news(batch["events"])

    if args.html is None:
        json.dump(feed, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    # Escape "<" so a headline can never close the inline <script> block.
    feed_js = json.dumps(feed, ensure_ascii=False).replace("<", "\\u003c")
    page = TEMPLATE.read_text(encoding="utf-8").replace(FEED_PLACEHOLDER, feed_js)
    args.html.write_text(page, encoding="utf-8")
    print(f"Wrote {args.html}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
