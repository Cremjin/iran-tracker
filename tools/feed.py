"""Fetch Trump's Truth Social posts from the trumpstruth.org RSS archive (stdlib only).

The feed returns at most 100 items by default; the undocumented `limit` param raises that
to 500 (501+ is a 400). A window that still hits the cap is split in half and re-fetched. Post text is extracted one way only (`item_text`); the validator uses the
same function, which is what makes "byte-identical to the feed item" checkable (P1).

CLI: python3 tools/feed.py START END [--iran]   -> JSON list of original posts
"""
import html, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

FEED = "https://www.trumpstruth.org/feed"  # www host only; the bare host redirects
CAP = 500
NS = {"archive": "https://www.trumpstruth.org/rss-extensions"}
IRAN = re.compile(r"\b(iran\w*|tehran|persian gulf|hormuz|khamenei|ayatollah|irgc|"
                  r"araghchi|pezeshkian|fordow|natanz|isfahan|kharg)\b", re.I)


def _get(start, end):
    url = f"{FEED}?start_date={start}&end_date={end}&limit={CAP}"
    req = urllib.request.Request(url, headers={"User-Agent": "iran-tracker (github pages)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return ET.fromstring(r.read())


def item_text(desc):
    """Visible text of the item's HTML description; paragraphs joined by blank lines.
    The archive's own "View image/video" attachment links are not part of the post."""
    desc = re.sub(r'<a href="https://truth-archive[^"]*"[^>]*>.*?</a>', "", desc, flags=re.S)
    paras = re.findall(r"<p>(.*?)</p>", desc, re.S) or [desc]
    paras = [html.unescape(re.sub(r"<[^>]+>", "", p)).strip() for p in paras]
    return "\n\n".join(p for p in paras if p)


def parse(root):
    out = []
    for it in root.iter("item"):
        when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        url = it.findtext("link").strip()
        out.append({
            "id": int(url.rsplit("/", 1)[1]),
            "url": url,
            "time": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "date": when.date().isoformat(),
            "type": it.findtext("archive:postType", "", NS),
            "removed": it.findtext("archive:removed", "", NS) == "true",
            "text": item_text(it.findtext("description") or ""),
        })
    return out


def fetch(start, end):
    """All items with start <= date <= end (feed dates, inclusive), splitting capped windows."""
    s, e = date.fromisoformat(str(start)), date.fromisoformat(str(end))
    items = parse(_get(s, e))
    if len(items) >= CAP:
        if s == e:
            raise RuntimeError(f"{s}: a single day hit the {CAP}-item cap; cannot split further")
        mid = s + (e - s) // 2
        items = fetch(s, mid) + fetch(mid + timedelta(days=1), e)
    return sorted({i["id"]: i for i in items}.values(), key=lambda i: i["time"])


def originals(items):
    """Trump's own non-removed posts with text; reposts are someone else's words or duplicates."""
    return [i for i in items if i["type"] == "original" and not i["removed"] and i["text"]]


def iran(items):
    return [i for i in originals(items) if IRAN.search(i["text"])]


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    items = fetch(args[0], args[1] if len(args) > 1 else args[0])
    json.dump(iran(items) if "--iran" in sys.argv else originals(items), sys.stdout, indent=1, ensure_ascii=False)
