#!/usr/bin/env python3
"""
Bidirectional watchlist/holding sync for stock11-7 <-> stock5-8.

Mapping:
  stock11 list 0 + yellow highlight <-> stock5 "1. 롱 보유"
  stock11 list 0 + red highlight    <-> stock5 "2. 숏 보유"
  stock11 list 3                    <-> stock5 "3. 롱 관심"
  stock11 list 4                    <-> stock5 "4. 숏 관심"

Rules:
- First initialization is stock11-authoritative.
- Holding membership has display priority over interest membership in stock5.
  The original stock11 long/short interest list is preserved, so clearing the
  holding highlight makes the symbol reappear in stock5's interest group.
- stock5 holding order follows stock11 list 0 order.
- stock5 interest order follows stock11 list 3/4 order.
- On same-symbol concurrent changes, stock11 wins.
- Unsupported stock5 rows (for example markets stock11 cannot represent) are
  preserved rather than deleted.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GROUPS = {
    "hold_long": "1. 롱 보유",
    "hold_short": "2. 숏 보유",
    "interest_long": "3. 롱 관심",
    "interest_short": "4. 숏 관심",
}
GROUP_TO_LOGICAL = {value: key for key, value in GROUPS.items()}
SUPPORTED = {"KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "AMEX"}

STATE_DIR = Path(os.environ.get(
    "STOCK_INTEREST_SYNC_STATE_DIR",
    "/var/lib/stock-interest-sync",
))
STATE = STATE_DIR / "state.json"
BACKUP_DIR = Path(os.environ.get(
    "STOCK_INTEREST_SYNC_BACKUP_DIR",
    "/var/backups/stock-interest-sync",
))

STOCK11_ENV = Path(os.environ.get(
    "STOCK_INTEREST_SYNC_STOCK11_ENV",
    "/var/www/stock11-7/.env.oracle",
))
STOCK11_BASE_PATH = (
    os.environ.get(
        "STOCK_INTEREST_SYNC_STOCK11_BASE_PATH",
        "/stock11-7",
    ).rstrip("/")
    or ""
)

STOCK5_APP_DIR = Path(os.environ.get(
    "STOCK_INTEREST_SYNC_STOCK5_APP_DIR",
    "/var/www/stock5-8",
))
STOCK5_BASE_URL = os.environ.get(
    "STOCK_INTEREST_SYNC_STOCK5_BASE_URL",
    "",
).rstrip("/")

INTERVAL_SEC = max(
    1.0,
    float(os.environ.get("STOCK_INTEREST_SYNC_INTERVAL_SEC", "3")),
)
MAX_STOCK5_ITEMS = max(
    1,
    int(os.environ.get("STOCK_INTEREST_SYNC_MAX_STOCK5_ITEMS", "100")),
)
VERIFY_TLS = os.environ.get(
    "STOCK_INTEREST_SYNC_VERIFY_TLS",
    "false",
).strip().lower() in {"1", "true", "yes", "on"}

CTX = ssl.create_default_context() if VERIFY_TLS else ssl._create_unverified_context()
CACHE: dict[str, tuple[str, dict[str, Any]] | None] = {}


class RetryCycle(RuntimeError):
    """A benign concurrent write was observed; retry on the next poll."""


def log(text: str) -> None:
    print("[sync]", text, flush=True)


def read_env_file(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return result

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()

        key, value = line.split("=", 1)
        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in "'\""
        ):
            value = value[1:-1]
        result[key.strip()] = value

    return result


def stock5_password() -> str:
    explicit = os.environ.get("STOCK_INTEREST_SYNC_STOCK5_PASSWORD", "")
    if explicit:
        return explicit

    values: dict[str, str] = {}
    for path in (
        STOCK5_APP_DIR / ".env.local",
        STOCK5_APP_DIR / ".env",
    ):
        values.update(read_env_file(path))

    if values.get("STOCK5_PASSWORD"):
        return values["STOCK5_PASSWORD"]

    try:
        pid = subprocess.check_output(
            [
                "systemctl",
                "show",
                "webapp-stock5-8.service",
                "-p",
                "MainPID",
                "--value",
            ],
            text=True,
        ).strip()
        if pid and pid != "0":
            entries = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
            for entry in entries:
                if entry.startswith(b"STOCK5_PASSWORD="):
                    return entry.split(b"=", 1)[1].decode(errors="ignore")
    except Exception:
        pass

    # stock5-8 currently has this fallback in api/_state.js.
    return "1222"


def make_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        urllib.request.HTTPSHandler(context=CTX),
    )


def request_json(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    body: Any = None,
    headers: dict[str, str] | None = None,
) -> Any:
    request_headers = dict(headers or {})
    data = None

    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        request_headers.setdefault("Content-Type", "application/json")

    request = urllib.request.Request(
        url,
        data=data,
        headers=request_headers,
        method=method,
    )
    with opener.open(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw.decode()) if raw else {}


class Stock11:
    def __init__(self) -> None:
        values = read_env_file(STOCK11_ENV)
        self.password = values.get("STOCK11_SYNC_PASSWORD", "")
        if not self.password:
            raise RuntimeError("stock11 STOCK11_SYNC_PASSWORD is missing")

        configured = os.environ.get(
            "STOCK_INTEREST_SYNC_STOCK11_ORIGIN",
            values.get("STOCK11_SYNC_ORIGIN", ""),
        ).strip().rstrip("/")

        self.origin = configured or "http://127.0.0.1:3011"
        self.base = self.origin + STOCK11_BASE_PATH
        self.opener = make_opener()
        self.logged = False

    def login(self) -> None:
        result = request_json(
            self.opener,
            "POST",
            self.base + "/api/session",
            {"password": self.password},
            {"Origin": self.origin},
        )
        if not result.get("authenticated"):
            raise RuntimeError("stock11 login failed")
        self.logged = True

    def profile(self) -> dict[str, Any]:
        if not self.logged:
            self.login()

        try:
            result = request_json(
                self.opener,
                "GET",
                self.base + "/api/profile",
            )
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
            self.logged = False
            self.login()
            result = request_json(
                self.opener,
                "GET",
                self.base + "/api/profile",
            )

        profile = result.get("profile")
        if not isinstance(profile, dict):
            raise RuntimeError("stock11 profile response is invalid")
        return profile

    def patch(self, operation: dict[str, Any]) -> dict[str, Any]:
        if not self.logged:
            self.login()

        payload = {
            "id": str(uuid.uuid4()),
            "operation": operation,
        }

        try:
            result = request_json(
                self.opener,
                "PATCH",
                self.base + "/api/profile",
                payload,
                {"Origin": self.origin},
            )
        except urllib.error.HTTPError as error:
            if error.code != 401:
                detail = error.read().decode(errors="ignore")
                raise RuntimeError(
                    f"stock11 PATCH {error.code}: {detail[:200]}"
                ) from error
            self.logged = False
            self.login()
            result = request_json(
                self.opener,
                "PATCH",
                self.base + "/api/profile",
                payload,
                {"Origin": self.origin},
            )

        profile = result.get("profile")
        if not isinstance(profile, dict):
            raise RuntimeError("stock11 PATCH response is invalid")
        return profile

    def search(self, query: str) -> list[dict[str, Any]]:
        url = (
            self.base
            + "/api/search?q="
            + urllib.parse.quote(query)
        )
        result = request_json(self.opener, "GET", url)
        items = result.get("items")
        return items if isinstance(items, list) else []


class Stock5:
    def __init__(self) -> None:
        if not STOCK5_BASE_URL:
            raise RuntimeError(
                "STOCK_INTEREST_SYNC_STOCK5_BASE_URL is required"
            )
        self.password = stock5_password()
        self.opener = make_opener()

    def state(self) -> dict[str, Any]:
        result = request_json(
            self.opener,
            "GET",
            STOCK5_BASE_URL + "/api/state",
            headers={"x-stock5-password": self.password},
        )
        if not isinstance(result, dict):
            raise RuntimeError("stock5 state response is invalid")
        return result

    def put(self, state: dict[str, Any]) -> dict[str, Any]:
        count = len(state.get("items", []))
        if count > MAX_STOCK5_ITEMS:
            raise RuntimeError(
                f"stock5 total {count} exceeds limit {MAX_STOCK5_ITEMS}"
            )
        result = request_json(
            self.opener,
            "PUT",
            STOCK5_BASE_URL + "/api/state",
            state,
            {"x-stock5-password": self.password},
        )
        if not isinstance(result, dict):
            raise RuntimeError("stock5 PUT response is invalid")
        return result

    def put_if_unchanged(
        self,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> dict[str, Any]:
        latest = self.state()
        if latest != before:
            raise RetryCycle("stock5 changed while sync was preparing an update")
        return self.put(after)


def watchlists(profile: dict[str, Any]) -> list[list[dict[str, Any]]]:
    values = profile.get("watchlists")
    if not isinstance(values, list):
        values = [profile.get("watchlist", [])]

    lists: list[list[dict[str, Any]]] = []
    for value in values[:5]:
        lists.append(list(value) if isinstance(value, list) else [])
    while len(lists) < 5:
        lists.append([])
    return lists


def canonical11(item: dict[str, Any]) -> str | None:
    market = str(item.get("market", "")).upper()
    code = str(item.get("code", "")).upper()

    if market not in SUPPORTED or not code:
        return None
    return f"{market}:{code}"


def symbol_key11(item: dict[str, Any]) -> str | None:
    market = str(item.get("market", "")).upper()
    chart = str(item.get("chartCode", ""))
    if market not in SUPPORTED or not chart:
        return None
    return f"{market}:{chart}"


def highlights(profile: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for pair in profile.get("highlights", []):
        if (
            isinstance(pair, list)
            and len(pair) == 2
            and pair[1] in ("yellow", "red")
        ):
            result[str(pair[0])] = str(pair[1])
    return result


def logical11(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lists = watchlists(profile)
    colors = highlights(profile)

    result = {
        key: {"order": [], "map": {}}
        for key in GROUPS
    }

    # Holding group order is exactly stock11 list 0 order, filtered by color.
    for item in lists[0]:
        key = canonical11(item)
        highlight_key = symbol_key11(item)
        if not key or not highlight_key:
            continue

        color = colors.get(highlight_key)
        logical = (
            "hold_long"
            if color == "yellow"
            else "hold_short"
            if color == "red"
            else None
        )

        if logical and key not in result[logical]["map"]:
            result[logical]["order"].append(key)
            result[logical]["map"][key] = item

    held = (
        set(result["hold_long"]["order"])
        | set(result["hold_short"]["order"])
    )

    # Keep stock11 long/short interest membership, but hide a currently held
    # symbol from stock5's interest groups. It reappears when the hold color
    # is cleared.
    for logical, index in (
        ("interest_long", 3),
        ("interest_short", 4),
    ):
        for item in lists[index]:
            key = canonical11(item)
            if (
                not key
                or key in held
                or key in result[logical]["map"]
            ):
                continue
            result[logical]["order"].append(key)
            result[logical]["map"][key] = item

    overlap = (
        set(result["interest_long"]["order"])
        & set(result["interest_short"]["order"])
    )
    if overlap:
        raise RuntimeError("stock11 long/short interest overlap")

    return result


def same_ticker(first: Any, second: Any) -> bool:
    def normalize(value: Any) -> str:
        return "".join(
            char
            for char in str(value).upper()
            if char.isalnum()
        )

    return normalize(first) == normalize(second)


def resolve5(
    stock11: Stock11,
    item: dict[str, Any],
) -> tuple[str, dict[str, Any]] | None:
    symbol = str(item.get("symbol", "")).strip()
    upper = symbol.upper()
    name = str(item.get("name", "")).strip()
    exchange = str(item.get("exchange", "")).upper()

    if not symbol or upper.startswith("^") or "=" in upper:
        return None

    if upper.endswith(".KS") and len(upper[:-3]) == 6:
        code = upper[:-3]
        selection = {
            "market": "KOSPI",
            "code": code,
            "chartCode": code,
            "name": name or code,
        }
        return f"KOSPI:{code}", selection

    if upper.endswith(".KQ") and len(upper[:-3]) == 6:
        code = upper[:-3]
        selection = {
            "market": "KOSDAQ",
            "code": code,
            "chartCode": code,
            "name": name or code,
        }
        return f"KOSDAQ:{code}", selection

    if (
        upper.isdigit()
        and len(upper) == 6
        and exchange in ("KOSPI", "KOSDAQ")
    ):
        selection = {
            "market": exchange,
            "code": upper,
            "chartCode": upper,
            "name": name or upper,
        }
        return f"{exchange}:{upper}", selection

    if upper in CACHE:
        return CACHE[upper]

    match = next(
        (
            value
            for value in stock11.search(symbol)
            if (
                value.get("market") in SUPPORTED
                and same_ticker(value.get("code", ""), upper)
            )
        ),
        None,
    )

    if not match:
        CACHE[upper] = None
        return None

    selection = {
        key: match[key]
        for key in ("market", "code", "chartCode", "name")
    }
    if match.get("instrumentType") == "etf":
        selection["instrumentType"] = "etf"

    resolved = canonical11(selection), selection
    if not resolved[0]:
        CACHE[upper] = None
        return None

    CACHE[upper] = (resolved[0], selection)
    return CACHE[upper]


def logical5(
    stock11: Stock11,
    state: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    result = {
        key: {"order": [], "map": {}}
        for key in GROUPS
    }
    seen_global: dict[str, str] = {}

    for row in state.get("items", []):
        if not isinstance(row, dict):
            continue

        logical = GROUP_TO_LOGICAL.get(row.get("group"))
        if not logical:
            continue

        resolved = resolve5(stock11, row)
        if not resolved:
            continue

        key, selection = resolved
        other = seen_global.get(key)
        if other and other != logical:
            raise RuntimeError(
                f"stock5 duplicate across groups: {key}"
            )
        seen_global[key] = logical

        if key not in result[logical]["map"]:
            result[logical]["order"].append(key)
            result[logical]["map"][key] = (row, selection)

    return result


def stock5_symbol(item: dict[str, Any]) -> str:
    code = str(item.get("code", "")).upper()
    if item.get("market") == "KOSPI":
        return code + ".KS"
    if item.get("market") == "KOSDAQ":
        return code + ".KQ"
    return code


def make_stock5_row(
    item: dict[str, Any],
    group: str,
    old: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = dict(old or {})
    row["id"] = row.get("id") or str(uuid.uuid4())
    row["symbol"] = row.get("symbol") or stock5_symbol(item)
    row["name"] = row.get("name") or item.get("name") or item.get("code")
    row["exchange"] = row.get("exchange") or item.get("market") or ""
    row["type"] = (
        row.get("type")
        or ("etf" if item.get("instrumentType") == "etf" else "")
    )
    row["group"] = group
    row.setdefault("memo", "")
    row.setdefault("memoPosition", {"x": 12, "y": 58})
    row.setdefault("memoSize", {"width": 145, "height": 78})
    return row


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def load_snapshot() -> dict[str, Any]:
    try:
        value = json.loads(STATE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def row_cache_from(
    stock11: Stock11,
    state: dict[str, Any],
    previous: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    cache = dict((previous or {}).get("rowCache", {}))

    for row in state.get("items", []):
        if not isinstance(row, dict):
            continue
        resolved = resolve5(stock11, row)
        if resolved:
            cache[resolved[0]] = row

    return cache


def project_stock5(
    stock11: Stock11,
    state: dict[str, Any],
    desired: dict[str, dict[str, Any]],
    previous: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    cache = row_cache_from(stock11, state, previous)
    unsupported = {key: [] for key in GROUPS}
    other: list[dict[str, Any]] = []

    for row in state.get("items", []):
        if not isinstance(row, dict):
            continue

        logical = GROUP_TO_LOGICAL.get(row.get("group"))
        if not logical:
            other.append(row)
            continue

        if resolve5(stock11, row) is None:
            unsupported[logical].append(row)

    items: list[dict[str, Any]] = []
    used: set[str] = set()

    # This fixed group order is stock5's display order. Within each group,
    # desired[logical]["order"] is stock11's exact relative order.
    for logical in (
        "hold_long",
        "hold_short",
        "interest_long",
        "interest_short",
    ):
        for key in desired[logical]["order"]:
            if key in used:
                continue
            items.append(
                make_stock5_row(
                    desired[logical]["map"][key],
                    GROUPS[logical],
                    cache.get(key),
                )
            )
            used.add(key)

        # Keep rows stock11 cannot represent instead of deleting user data.
        items.extend(unsupported[logical])

    items.extend(other)

    if len(items) > MAX_STOCK5_ITEMS:
        raise RuntimeError(
            f"projected stock5 total {len(items)} "
            f"exceeds limit {MAX_STOCK5_ITEMS}"
        )

    next_state = dict(state)
    next_state["items"] = items
    return next_state, cache


def snapshot(
    stock11: Stock11,
    profile: dict[str, Any],
    state: dict[str, Any],
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state11 = logical11(profile)
    state5 = logical5(stock11, state)
    cache = row_cache_from(stock11, state, previous)

    return {
        "version": 2,
        "initialized": True,
        "stock11": {
            key: list(state11[key]["order"])
            for key in GROUPS
        },
        "stock5": {
            key: list(state5[key]["order"])
            for key in GROUPS
        },
        "rowCache": cache,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def delta(
    current: list[str],
    previous: list[str],
) -> tuple[set[str], set[str]]:
    current_set = set(current)
    previous_set = set(previous)
    return current_set - previous_set, previous_set - current_set


def find_list_item(
    profile: dict[str, Any],
    index: int,
    canonical_key: str,
) -> dict[str, Any] | None:
    for item in watchlists(profile)[index]:
        if canonical11(item) == canonical_key:
            return item
    return None


def ensure_list_item(
    stock11: Stock11,
    profile: dict[str, Any],
    index: int,
    canonical_key: str,
    selection: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    existing = find_list_item(profile, index, canonical_key)
    if existing:
        return profile, existing

    if not selection:
        raise RuntimeError(
            f"missing stock selection for {canonical_key}"
        )

    profile = stock11.patch(
        {
            "type": "add",
            "item": selection,
            "list": index,
        }
    )
    existing = find_list_item(profile, index, canonical_key)
    if not existing:
        raise RuntimeError(
            f"failed to add {canonical_key} to stock11 list {index}"
        )
    return profile, existing


def remove_list_item(
    stock11: Stock11,
    profile: dict[str, Any],
    index: int,
    canonical_key: str,
) -> dict[str, Any]:
    existing = find_list_item(profile, index, canonical_key)
    if not existing:
        return profile

    highlight_key = symbol_key11(existing)
    if not highlight_key:
        return profile

    return stock11.patch(
        {
            "type": "remove",
            "key": highlight_key,
            "list": index,
        }
    )


def set_holding_from_stock5(
    stock11: Stock11,
    profile: dict[str, Any],
    canonical_key: str,
    color: str | None,
    selection: dict[str, Any] | None,
) -> dict[str, Any]:
    existing = find_list_item(profile, 0, canonical_key)

    if color in ("yellow", "red"):
        profile, existing = ensure_list_item(
            stock11,
            profile,
            0,
            canonical_key,
            selection,
        )
        highlight_key = symbol_key11(existing)
        if not highlight_key:
            raise RuntimeError(
                f"missing highlight key for {canonical_key}"
            )

        current = highlights(profile).get(highlight_key)
        if current != color:
            profile = stock11.patch(
                {
                    "type": "highlight",
                    "key": highlight_key,
                    "color": color,
                }
            )
        return profile

    # Removing a hold in stock5 clears the color only. The stock remains in
    # stock11 list 0.
    if existing:
        highlight_key = symbol_key11(existing)
        if (
            highlight_key
            and highlights(profile).get(highlight_key)
            in ("yellow", "red")
        ):
            profile = stock11.patch(
                {
                    "type": "highlight",
                    "key": highlight_key,
                    "color": None,
                }
            )

    return profile


def set_interest_from_stock5(
    stock11: Stock11,
    profile: dict[str, Any],
    canonical_key: str,
    target: str | None,
    selection: dict[str, Any] | None,
) -> dict[str, Any]:
    if target == "interest_long":
        profile = remove_list_item(
            stock11,
            profile,
            4,
            canonical_key,
        )
        profile, _ = ensure_list_item(
            stock11,
            profile,
            3,
            canonical_key,
            selection,
        )
        return profile

    if target == "interest_short":
        profile = remove_list_item(
            stock11,
            profile,
            3,
            canonical_key,
        )
        profile, _ = ensure_list_item(
            stock11,
            profile,
            4,
            canonical_key,
            selection,
        )
        return profile

    profile = remove_list_item(
        stock11,
        profile,
        3,
        canonical_key,
    )
    profile = remove_list_item(
        stock11,
        profile,
        4,
        canonical_key,
    )
    return profile


def initialize(
    stock11: Stock11,
    stock5: Stock5,
    profile: dict[str, Any],
    state: dict[str, Any],
) -> None:
    # First run: stock11 is authoritative for all four synchronized groups.
    desired = logical11(profile)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    directory = BACKUP_DIR / stamp
    directory.mkdir(parents=True, exist_ok=False)
    os.chmod(directory, 0o700)

    write_json(directory / "stock11-profile.json", profile)
    write_json(directory / "stock5-state.json", state)

    projected, _ = project_stock5(
        stock11,
        state,
        desired,
    )

    final_state = (
        stock5.put_if_unchanged(state, projected)
        if projected != state
        else state
    )

    write_json(
        STATE,
        snapshot(
            stock11,
            profile,
            final_state,
        ),
    )

    log(
        "v2 initial complete / "
        f"hold-long {len(desired['hold_long']['order'])} / "
        f"hold-short {len(desired['hold_short']['order'])} / "
        f"interest-long {len(desired['interest_long']['order'])} / "
        f"interest-short {len(desired['interest_short']['order'])} / "
        f"stock5 total {len(final_state.get('items', []))} / "
        f"backup {directory}"
    )


def sync_once(
    stock11: Stock11,
    stock5: Stock5,
) -> None:
    profile = stock11.profile()
    start_revision = int(profile.get("revision", -1))
    state = stock5.state()
    saved = load_snapshot()

    if saved.get("version") != 2 or not saved.get("initialized"):
        initialize(stock11, stock5, profile, state)
        return

    current11 = logical11(profile)
    current5 = logical5(stock11, state)

    # A symbol changed on stock11 during this cycle has conflict priority.
    touched11: set[str] = set()
    for logical in GROUPS:
        adds, deletes = delta(
            current11[logical]["order"],
            saved.get("stock11", {}).get(logical, []),
        )
        touched11 |= adds | deletes

    # Before pushing stock5 changes into stock11, make sure stock11 itself did
    # not change after our initial read. If it did, retry next cycle so we never
    # write based on a stale revision.
    fresh_profile = stock11.profile()
    if int(fresh_profile.get("revision", -1)) != start_revision:
        raise RetryCycle("stock11 changed during sync cycle")
    profile = fresh_profile

    changed_hold_keys: set[str] = set()
    for logical in ("hold_long", "hold_short"):
        adds, deletes = delta(
            current5[logical]["order"],
            saved.get("stock5", {}).get(logical, []),
        )
        changed_hold_keys |= adds | deletes

    for key in sorted(changed_hold_keys - touched11):
        if key in current5["hold_long"]["map"]:
            selection = current5["hold_long"]["map"][key][1]
            profile = set_holding_from_stock5(
                stock11,
                profile,
                key,
                "yellow",
                selection,
            )
        elif key in current5["hold_short"]["map"]:
            selection = current5["hold_short"]["map"][key][1]
            profile = set_holding_from_stock5(
                stock11,
                profile,
                key,
                "red",
                selection,
            )
        else:
            profile = set_holding_from_stock5(
                stock11,
                profile,
                key,
                None,
                None,
            )

    changed_interest_keys: set[str] = set()
    for logical in ("interest_long", "interest_short"):
        adds, deletes = delta(
            current5[logical]["order"],
            saved.get("stock5", {}).get(logical, []),
        )
        changed_interest_keys |= adds | deletes

    for key in sorted(changed_interest_keys - touched11):
        if key in current5["interest_long"]["map"]:
            selection = current5["interest_long"]["map"][key][1]
            profile = set_interest_from_stock5(
                stock11,
                profile,
                key,
                "interest_long",
                selection,
            )
        elif key in current5["interest_short"]["map"]:
            selection = current5["interest_short"]["map"][key][1]
            profile = set_interest_from_stock5(
                stock11,
                profile,
                key,
                "interest_short",
                selection,
            )
        else:
            profile = set_interest_from_stock5(
                stock11,
                profile,
                key,
                None,
                None,
            )

    # Final stock11 profile is authoritative for display membership/order.
    profile = stock11.profile()
    desired = logical11(profile)

    # Re-read stock5 before projecting. If the browser changed stock5 while
    # stock11 PATCH requests were in flight, defer instead of overwriting it.
    latest_state = stock5.state()
    if latest_state != state:
        raise RetryCycle("stock5 changed during sync cycle")

    projected, _ = project_stock5(
        stock11,
        latest_state,
        desired,
        saved,
    )

    if projected != latest_state:
        state = stock5.put_if_unchanged(
            latest_state,
            projected,
        )
    else:
        state = latest_state

    write_json(
        STATE,
        snapshot(
            stock11,
            profile,
            state,
            saved,
        ),
    )


def check_sync(
    stock11: Stock11,
    stock5: Stock5,
) -> int:
    profile = stock11.profile()
    state = stock5.state()

    state11 = logical11(profile)
    state5 = logical5(stock11, state)

    labels = (
        ("hold_long", "1. 롱 보유"),
        ("hold_short", "2. 숏 보유"),
        ("interest_long", "3. 롱 관심"),
        ("interest_short", "4. 숏 관심"),
    )

    ok = True
    for key, label in labels:
        order11 = state11[key]["order"]
        order5 = state5[key]["order"]

        membership_ok = set(order11) == set(order5)
        order_ok = order11 == order5
        ok = ok and membership_ok and order_ok

        print(
            f"{label}: "
            f"stock11={len(order11)} "
            f"stock5={len(order5)} "
            f"SYNC={'OK' if membership_ok else 'MISMATCH'} "
            f"ORDER={'OK' if order_ok else 'MISMATCH'}"
        )

    print()
    print("stock11 기준 롱 보유 순서")
    for number, key in enumerate(state11["hold_long"]["order"], 1):
        item = state11["hold_long"]["map"][key]
        print(
            f"{number:02d}. "
            f"{item.get('name')} "
            f"({item.get('code')})"
        )

    print()
    print("stock11 기준 숏 보유 순서")
    for number, key in enumerate(state11["hold_short"]["order"], 1):
        item = state11["hold_short"]["map"][key]
        print(
            f"{number:02d}. "
            f"{item.get('name')} "
            f"({item.get('code')})"
        )

    print()
    print("TOTAL STOCK5 =", len(state.get("items", [])))
    return 0 if ok else 2


def prepare_dirs() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    os.chmod(BACKUP_DIR, 0o700)


def daemon() -> None:
    prepare_dirs()
    stock11: Stock11 | None = None
    stock5: Stock5 | None = None

    while True:
        try:
            if stock11 is None:
                stock11 = Stock11()
            if stock5 is None:
                stock5 = Stock5()

            sync_once(stock11, stock5)

        except RetryCycle as error:
            log(f"retry next cycle: {error}")

        except Exception as error:
            log(
                "retry: "
                f"{type(error).__name__}: "
                f"{error}"
            )
            if (
                isinstance(error, urllib.error.HTTPError)
                and error.code == 401
            ):
                stock11 = None
                stock5 = None

        time.sleep(INTERVAL_SEC)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--once",
        action="store_true",
        help="run one synchronization cycle and exit",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify membership and order without changing data",
    )
    args = parser.parse_args()

    if args.once and args.check:
        parser.error("--once and --check cannot be used together")

    if args.check:
        return check_sync(Stock11(), Stock5())

    if args.once:
        prepare_dirs()
        sync_once(Stock11(), Stock5())
        return 0

    daemon()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
