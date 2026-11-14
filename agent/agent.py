"""Mission Engineer: evaluates a user's idea and decides whether to send it to NASA.

Uses only the Python standard library, so there is nothing to install.
Pick the model provider in .env (see .env.example):
    PROVIDER = anthropic | openai | gemini | mock
"""

import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .prompt import SYSTEM_PROMPT, USER_TEMPLATE

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PROBLEMS_FILE = Path(__file__).resolve().parent / "problems.json"

WEIGHTS = {"root_cause": 5, "principle": 5, "novelty": 4, "feasibility": 3, "simplicity": 3}
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5-5",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-flash-latest",
}


# ---------------------------------------------------------------- settings

def load_env(path: Path = ROOT / ".env") -> None:
    """Read KEY=VALUE lines from .env into os.environ (without overriding)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()


def settings() -> dict:
    provider = os.getenv("PROVIDER", "").strip().lower()
    key = os.getenv("API_KEY", "").strip()
    if not provider:
        provider = "anthropic" if key else "mock"
    if provider != "mock" and not key:
        provider = "mock"
    model = os.getenv("MODEL", "").strip() or DEFAULT_MODELS.get(provider, "")
    return {"provider": provider, "api_key": key, "model": model}


def load_problems() -> dict:
    return json.loads(PROBLEMS_FILE.read_text(encoding="utf-8"))


def get_problem(problem_id: str) -> dict:
    for p in load_problems()["problems"]:
        if p["id"] == problem_id:
            return p
    raise ValueError(f"Unknown problem_id: {problem_id}")


# ---------------------------------------------------------------- model calls

def _post_json(url: str, body: dict, headers: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Model API error {e.code}: {detail}") from e


def call_anthropic(cfg: dict, system: str, user: str) -> str:
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        {
            "model": cfg["model"],
            "max_tokens": 1000,
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        {"x-api-key": cfg["api_key"], "anthropic-version": "2023-06-01"},
    )
    return "".join(block.get("text", "") for block in data.get("content", []))


def call_openai(cfg: dict, system: str, user: str) -> str:
    data = _post_json(
        "https://api.openai.com/v1/chat/completions",
        {
            "model": cfg["model"],
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        },
        {"Authorization": f"Bearer {cfg['api_key']}"},
    )
    return data["choices"][0]["message"]["content"]


def call_gemini(cfg: dict, system: str, user: str) -> str:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{cfg['model']}:generateContent?key={cfg['api_key']}"
    )
    data = _post_json(
        url,
        {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            # Newer Gemini models no longer accept temperature, so it is not sent.
            "generationConfig": {"responseMimeType": "application/json"},
        },
        {},
    )
    return data["candidates"][0]["content"]["parts"][0]["text"]


def call_mock(problem: dict, user_text: str, language: str) -> str:
    """Offline stand-in so the website can be tested without an API key.
    It does NOT judge ideas; it only returns a well-formed answer."""
    words = len(user_text.split())
    if words < 4:
        result = {
            "decision": "do_not_send", "engineering_principle": None, "scores": None,
            "total": 0, "reason": "No real idea was given.",
            "message_to_user": "اكتب فكرتك بجملة أو جملتين حتى نقدر نقيّمها!" if language == "ar"
            else "Write your idea in a sentence or two so we can evaluate it!",
            "nasa_report": None,
        }
        return json.dumps(result, ensure_ascii=False)
    novelty = 4 if words >= 15 else 3
    scores = {"root_cause": 4, "principle": 4, "novelty": novelty, "feasibility": 3, "simplicity": 4}
    result = {
        "decision": "do_not_send",  # the code below recomputes the real decision
        "engineering_principle": f"(mock) Proposed solution for: {problem['problem']}",
        "scores": scores, "total": 0,
        "reason": "(mock mode) Scores are placeholders; add an API key for real evaluation.",
        "message_to_user": "فكرة جميلة! شكراً لمشاركتك." if language == "ar"
        else "Nice idea! Thanks for sharing.",
        "nasa_report": f"(mock) Problem: {problem['problem']} Idea: {user_text[:200]}",
    }
    return json.dumps(result, ensure_ascii=False)


# ---------------------------------------------------------------- checking the answer

def parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in the model's answer")
    return json.loads(text[start:end + 1])


def check_result(result: dict) -> dict:
    """Make the answer safe to use: clamp scores, recompute the total and
    re-apply the decision rule, so a math slip by the model can't send a weak idea."""
    scores = result.get("scores")
    if isinstance(scores, dict) and all(k in scores for k in WEIGHTS):
        clean = {k: min(5, max(1, int(round(float(scores[k]))))) for k in WEIGHTS}
        total = sum(WEIGHTS[k] * clean[k] for k in WEIGHTS)
        passes = (clean["root_cause"] >= 3 and clean["principle"] >= 3
                  and clean["novelty"] >= 4 and total >= 75)
        decision = "send_to_nasa" if passes else "do_not_send"
        result["corrected_by_code"] = (decision != result.get("decision")
                                       or total != result.get("total"))
        result["scores"], result["total"], result["decision"] = clean, total, decision
    else:
        result.update({"scores": None, "total": 0, "decision": "do_not_send",
                       "corrected_by_code": result.get("decision") == "send_to_nasa"})
    if result["decision"] != "send_to_nasa":
        result["nasa_report"] = None
    for field in ("engineering_principle", "reason", "message_to_user"):
        result.setdefault(field, None)
    return result


# ---------------------------------------------------------------- main entry point

def evaluate(problem_id: str, user_text: str, language: str = "ar") -> dict:
    cfg = settings()
    problem = get_problem(problem_id)
    user_text = (user_text or "").strip()[:2000]
    language = "en" if language == "en" else "ar"

    card = {**problem, "mars_environment": load_problems()["mars_environment"]}
    for field in ("title", "title_ar", "problem_ar", "fact", "fact_ar"):
        card.pop(field, None)
    user_msg = USER_TEMPLATE.format(
        problem_card_json=json.dumps(card, ensure_ascii=False, indent=2),
        user_language=language,
        user_text=user_text,
    )

    callers = {"anthropic": call_anthropic, "openai": call_openai, "gemini": call_gemini}
    last_error = None
    for _attempt in range(2):  # retry once if the JSON is broken
        try:
            if cfg["provider"] == "mock":
                raw = call_mock(problem, user_text, language)
            else:
                raw = callers[cfg["provider"]](cfg, SYSTEM_PROMPT, user_msg)
            result = check_result(parse_json(raw))
            break
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            last_error = e
    else:
        raise RuntimeError(f"The model did not return valid JSON: {last_error}")

    record = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "problem_id": problem_id,
        "language": language,
        "provider": cfg["provider"],
        "model": cfg["model"] if cfg["provider"] != "mock" else "mock",
        **result,
    }
    save(record)
    return record


def save(record: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with open(DATA_DIR / "submissions.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_submissions() -> list:
    path = DATA_DIR / "submissions.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def build_nasa_report() -> str:
    """All ideas the agent decided to send, grouped by problem, as Markdown."""
    titles = {p["id"]: p["title"] for p in load_problems()["problems"]}
    chosen = [s for s in load_submissions() if s.get("decision") == "send_to_nasa"]
    lines = [
        "# Ideas from young explorers — report for NASA",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} · {len(chosen)} idea(s) selected by the Mission Engineer agent",
        "",
    ]
    for pid, title in titles.items():
        group = [s for s in chosen if s["problem_id"] == pid]
        if not group:
            continue
        lines += [f"## {title}", ""]
        for i, s in enumerate(sorted(group, key=lambda s: -s["total"]), 1):
            lines += [
                f"### Idea {i} — score {s['total']}/100",
                f"- Principle: {s.get('engineering_principle')}",
                f"- Summary: {s.get('nasa_report')}",
                "",
            ]
    if not chosen:
        lines.append("No ideas selected yet.")
    return "\n".join(lines)
