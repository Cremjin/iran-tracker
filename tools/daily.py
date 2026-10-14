"""The routine's deterministic steps, so the model only does the judgement (classification).

  python3 tools/daily.py fetch CANDIDATES.json [--through YYYY-MM-DD]
      Fetch every Iran post since status.coveredThrough (through yesterday UTC by default)
      that isn't in data/posts.json yet. Exit 2 on any fetch error.
  python3 tools/daily.py merge CANDIDATES.json [CLASSIFIED.json]
      Add the candidates with their classification, copying text/url/time from the feed
      items (never from the model, P1), and record a successful run in data/status.json.
  python3 tools/daily.py fail [--date YYYY-MM-DD] "reason"
      Record a failed fetch day (default today UTC; --date lets QA simulate past days).
      Prints ALERT exactly once per outage, on the 2nd failed day.

CLASSIFIED.json maps each candidate url to {category, sentiment, analysis, contradicts,
contradictionReason}; contradicts items are existing post ids or candidate urls.
"""
import json, sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import feed

DATA = Path(__file__).resolve().parent.parent / "data"
POSTS, STATUS = DATA / "posts.json", DATA / "status.json"
FIELDS = ("category", "sentiment", "analysis", "contradicts", "contradictionReason")


def load(p):
    return json.loads(p.read_text())


def save(p, obj):
    p.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def today():
    return datetime.now(timezone.utc).date()


def cmd_fetch(out, through=None):
    status, posts = load(STATUS), load(POSTS)["posts"]
    start = date.fromisoformat(status["coveredThrough"]) + timedelta(days=1)
    end = date.fromisoformat(through) if through else today() - timedelta(days=1)
    known = {p["url"] for p in posts}
    try:
        new = [i for i in feed.iran(feed.fetch(start, end)) if i["url"] not in known] if start <= end else []
    except Exception as e:  # network, HTTP, XML or cap errors all mean "no verified data today"
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(2)
    save(Path(out), {"start": str(start), "end": str(end), "posts": new})
    print(f"{len(new)} new Iran posts, {start} to {end}")


def cmd_merge(cand_path, cls_path=None):
    cand = load(Path(cand_path))
    cls = load(Path(cls_path)) if cls_path else {}
    data, status = load(POSTS), load(STATUS)
    missing = [c["url"] for c in cand["posts"] if c["url"] not in cls]
    if missing:
        sys.exit(f"unclassified candidates: {missing}")
    posts = data["posts"]
    by_url, next_id = {}, max((p["id"] for p in posts), default=0) + 1
    for c in sorted(cand["posts"], key=lambda c: c["time"]):
        post = {"id": next_id, **{k: c[k] for k in ("date", "time", "url", "text")},
                **{k: cls[c["url"]].get(k, [] if k == "contradicts" else "") for k in FIELDS}}
        posts.append(post)
        by_url[c["url"]] = next_id
        next_id += 1
    for p in posts:  # candidate urls -> ids; unknown urls stay as-is so the validator rejects them
        p["contradicts"] = [by_url.get(x, x) for x in p["contradicts"]]
    posts.sort(key=lambda p: p["time"])
    save(POSTS, data)
    status.update(lastSuccess=str(today()), coveredThrough=cand["end"], failures=[], alerted=False)
    save(STATUS, status)
    print(f"merged {len(by_url)} posts; covered through {cand['end']}")


def cmd_fail(reason, d=None):
    status, d = load(STATUS), d or str(today())
    if d not in [f["date"] for f in status["failures"]]:
        status["failures"].append({"date": d, "reason": reason[:300]})
    alert = len(status["failures"]) >= 2 and not status["alerted"]
    status["alerted"] = status["alerted"] or alert
    save(STATUS, status)
    print("ALERT" if alert else f"recorded failure {len(status['failures'])}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["fetch"]:
        cmd_fetch(a[1], a[a.index("--through") + 1] if "--through" in a else None)
    elif a[:1] == ["merge"]:
        cmd_merge(*a[1:3])
    elif a[:1] == ["fail"]:
        d = a.pop(a.index("--date") + 1) if "--date" in a else None
        cmd_fail(" ".join(x for x in a[1:] if x != "--date") or "unknown", d)
    else:
        sys.exit(__doc__)
