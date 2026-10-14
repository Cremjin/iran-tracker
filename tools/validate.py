"""Validate data/posts.json and data/status.json. Exit 1 with a list of errors on failure.

  python3 tools/validate.py                      structure, links, phases, status (offline)
  python3 tools/validate.py --online [--since D] also check every post dated >= D against the feed:
      it must exist there with byte-identical text (P1, P2), and from data.completeFrom on,
      every Iran post in the feed must be in the data. Default D: 7 days before coveredThrough.
"""
import json, re, sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import feed

DATA = Path(__file__).resolve().parent.parent / "data"
CATS = {"contradiction", "escalation", "deescalation", "threat", "claim", "neutral"}
URL = re.compile(r"^https://www\.trumpstruth\.org/statuses/\d+$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
QUOTE = re.compile(r'["\u201c]([^"\u201c\u201d]+)["\u201d]')
MONTH_DAY = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b")


def norm(t):
    """Compare quotes loosely on typography only: curly quotes, whitespace, case."""
    t = t.translate(str.maketrans("\u2018\u2019\u201c\u201d", "''\"\""))
    return re.sub(r"\s+", " ", t).strip().lower()


def quote_parts(framing):
    """Quoted spans in framing text, split at ellipses, trailing punctuation trimmed."""
    for q in QUOTE.findall(framing):
        for part in re.split(r"\.\.\.|\u2026", q):
            part = norm(part).rstrip(".,!?;: ").lstrip(" ")
            if part:
                yield part


def check_framing(p, by_id, w):
    """Framing may only quote the post itself or the posts it links to (P1)."""
    err = []
    own = norm(p.get("text", ""))
    linked = [by_id[r] for r in p.get("contradicts", []) if r in by_id]
    others = [norm(t.get("text", "")) for t in linked]
    for field in ("analysis", "contradictionReason"):
        for q in quote_parts(p.get(field, "")):
            if q not in own and not any(q in o for o in others):
                err.append(f"{w}: {field} quote not found in this or a linked post: \"{q}\"")
    reason = p.get("contradictionReason", "")
    if reason and linked:
        qs = list(quote_parts(reason))
        if not any(q in own for q in qs) or not any(q in o for q in qs for o in others):
            err.append(f"{w}: contradictionReason must quote both this post and a linked post")
        dates = {p.get("date")} | {t["date"] for t in linked}
        for mon, day in MONTH_DAY.findall(reason):
            d = datetime.strptime(f"{p['date'][:4]} {mon} {day}", "%Y %b %d").date().isoformat()
            if d not in dates:
                err.append(f"{w}: contradictionReason names {mon} {day}, which is not this or a linked post's date")
    return err


def check(data, status):
    err = []
    posts = data["posts"]
    by_id = {p["id"]: p for p in posts}
    if len(by_id) != len(posts):
        err.append("duplicate post ids")
    if len({p.get("url") for p in posts}) != len(posts):
        err.append("duplicate post urls")
    if [p["time"] for p in posts] != sorted(p["time"] for p in posts):
        err.append("posts are not sorted by time")

    phases = data["phases"]
    for a, b in zip(phases, phases[1:]):
        if not a["end"] or date.fromisoformat(a["end"]) + timedelta(days=1) != date.fromisoformat(b["start"]):
            err.append(f"phase '{b['name']}' does not start the day after '{a['name']}' ends")
    if phases[-1]["end"] is not None:
        err.append("the last phase must be open-ended (end: null)")

    def linked(ref, where):  # a link target must be an existing post with a source url
        t = by_id.get(ref)
        if t is None:
            err.append(f"{where}: links to missing post {ref!r}")
        elif not URL.match(t.get("url") or ""):
            err.append(f"{where}: links to post {ref} which has no source url")
        return t

    for p in posts:
        w = f"post {p.get('id')}"
        if not URL.match(p.get("url") or ""):
            err.append(f"{w}: missing or invalid url")
        if not (isinstance(p.get("text"), str) and p["text"].strip()):
            err.append(f"{w}: empty text")
        if not DAY.match(p.get("date", "")) or not p.get("time", "").startswith(p["date"]):
            err.append(f"{w}: bad date/time")
        if p.get("category") not in CATS:
            err.append(f"{w}: bad category {p.get('category')!r}")
        if not isinstance(p.get("sentiment"), (int, float)) or not -1 <= p["sentiment"] <= 1:
            err.append(f"{w}: sentiment must be a number in [-1, 1]")
        for ref in p.get("contradicts", []):
            t = linked(ref, w)
            if t and t["time"] >= p["time"]:
                err.append(f"{w}: contradicts {ref}, which is not earlier")
        if bool(p.get("contradicts")) != bool(p.get("contradictionReason")):
            err.append(f"{w}: contradicts and contradictionReason must both be set or both empty")
        if DAY.match(p.get("date", "")):
            err += check_framing(p, by_id, w)
        if not any(ph["start"] <= p.get("date", "") and (ph["end"] is None or p["date"] <= ph["end"]) for ph in phases):
            err.append(f"{w}: date {p.get('date')} is in no phase")
    for c in data["clusters"]:
        for ref in c["posts"]:
            linked(ref, f"cluster '{c['label']}'")

    for k in ("lastSuccess", "coveredThrough"):
        if not DAY.match(status.get(k, "")):
            err.append(f"status.{k} must be YYYY-MM-DD")
    if posts and posts[-1]["date"] > status.get("coveredThrough", ""):
        err.append("a post is dated after status.coveredThrough")
    if not isinstance(status.get("failures"), list) or not isinstance(status.get("alerted"), bool):
        err.append("status.failures must be a list and status.alerted a bool")
    return err


def check_online(data, status, since):
    err, end = [], status["coveredThrough"]
    items = feed.fetch(since, end)
    by_url = {i["url"]: i for i in items}
    mine = [p for p in data["posts"] if p["date"] >= since]
    for p in mine:
        i = by_url.get(p["url"])
        if i is None:
            err.append(f"post {p['id']}: not found in the feed ({p['url']})")
        elif i["text"] != p["text"]:
            err.append(f"post {p['id']}: text differs from the feed item")
    have = {p["url"] for p in mine}
    for i in feed.iran(items):
        if i["date"] >= data["completeFrom"] and i["url"] not in have:
            err.append(f"feed Iran post missing from data: {i['url']} ({i['date']})")
    return err


def main():
    data = json.loads((DATA / "posts.json").read_text())
    status = json.loads((DATA / "status.json").read_text())
    err = check(data, status)
    if "--online" in sys.argv and not err:  # online checks assume well-formed data
        a = sys.argv
        since = a[a.index("--since") + 1] if "--since" in a else str(date.fromisoformat(status["coveredThrough"]) - timedelta(days=7))
        err += check_online(data, status, since)
    for e in err:
        print("FAIL", e)
    print(f"{'INVALID' if err else 'OK'}: {len(data['posts'])} posts, {len(err)} errors")
    sys.exit(1 if err else 0)


if __name__ == "__main__":
    main()
