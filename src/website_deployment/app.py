from __future__ import annotations

import csv
import json
import math
import sqlite3
import threading
import urllib.parse
import urllib.request
import base64
import re
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import traceback


ROOT = Path(__file__).resolve().parent
DATASET_PATH = ROOT / "dataset" / "argyle_second_output.csv"
EMBED_CACHE_PATH = ROOT / "dataset" / "poster_embeddings_cache.json"
STAFF_DB_PATH = ROOT / "dataset" / "staff_posters.db"
UPLOADS_DIR = ROOT / "uploads" / "posters"
HOST = "127.0.0.1"
PORT = 8000
EMBED_MODEL = "nomic-embed-text"
MAX_RESULTS = 8
EMBED_THRESHOLD = 0.26
SEMANTIC_RESULTS_LIMIT = 24


def slugify_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")
    return cleaned or "poster-upload.png"


def get_staff_db() -> sqlite3.Connection:
    connection = sqlite3.connect(STAFF_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_staff_db() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    with get_staff_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS staff_posters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                performance_date TEXT DEFAULT '',
                categories TEXT DEFAULT '',
                entities TEXT DEFAULT '',
                extracted_text TEXT DEFAULT '',
                citation TEXT DEFAULT '',
                accession_id TEXT DEFAULT '',
                act_count INTEGER DEFAULT 0,
                source_file TEXT DEFAULT '',
                image_path TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        existing_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(staff_posters)").fetchall()
        }
        if "accession_id" not in existing_columns:
            connection.execute("ALTER TABLE staff_posters ADD COLUMN accession_id TEXT DEFAULT ''")
        if "act_count" not in existing_columns:
            connection.execute("ALTER TABLE staff_posters ADD COLUMN act_count INTEGER DEFAULT 0")
        connection.commit()


def derive_categories(poster: dict[str, Any]) -> str:
    searchable = " ".join(
        [
            poster.get("title", ""),
            poster.get("extracted_text", ""),
            " ".join(poster.get("entities", [])),
        ]
    ).lower()

    category_rules = {
        "Stunt performers": ["stunt"],
        "Comedians": ["comedian", "comedians", "comic", "comedienne", "humorous", "laugh", "farce"],
        "Gymnasts": ["gymnast"],
        "Musicians": ["musician", "instrumentalist", "musical", "violinist", "ragtime", "quartette"],
        "Dance": ["dance", "dancer", "dancers"],
        "Singing": ["sing", "song", "songs", "vocal", "vocalist", "ballad"],
        "Imitation": ["imitation", "mimic", "impersonation", "impersonator"],
        "Animal trainers": ["dog", "dogs", "animal", "animals", "trained"],
        "Male impersonators": ["male impersonator", "male impersonators"],
        "Tightrope walking": ["wire equilibrist", "tightrope", "rope"],
        "Acrobats": ["acrobatic", "acrobat", "tumbler", "clown"],
        "Motion pictures": ["bioscope", "motion pictures", "life-motion pictures", "picture"],
        "Jugglers": ["juggler", "juggling"],
        "Magic": ["wizard", "necromancer", "magic", "mysterious"],
        "Circus": ["circus"],
    }

    categories = [
        label
        for label, keywords in category_rules.items()
        if any(keyword in searchable for keyword in keywords)
    ]
    return ", ".join(categories)


def post_json(url: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def build_posters() -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    with DATASET_PATH.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames:
            reader.fieldnames = [name.lstrip("\ufeff").strip() if name else "" for name in reader.fieldnames]
        for row in reader:
            normalized_row = {
                (key.lstrip("\ufeff").strip() if key else ""): (value or "")
                for key, value in row.items()
            }
            source_file = normalized_row.get("source_file", "").strip()
            if not source_file:
                continue
            grouped.setdefault(source_file, []).append(normalized_row)

    posters: list[dict[str, Any]] = []
    for source_file, rows in grouped.items():
        first = rows[0]
        entities = sorted({row["act_name"].strip() for row in rows if row["act_name"].strip()})
        extracted_parts = []
        for row in rows:
            act_name = row["act_name"].strip()
            act_description = row["act_description"].strip()
            if act_name and act_description:
                extracted_parts.append(f"{act_name}. {act_description}")
            elif act_name:
                extracted_parts.append(act_name)
            elif act_description:
                extracted_parts.append(act_description)

        posters.append(
            {
                "id": source_file,
                "accession_id": first.get("accession_id", ""),
                "performance_date": first.get("performance_date", ""),
                "source_file": source_file,
                "image_path": f"images/posters/{source_file}",
                "act_count": len(rows),
                "title": first.get("performance_date", "") or source_file,
                "entities": entities,
                "extracted_text": "\n".join(extracted_parts),
                "citation": (
                    f"Argyle Theatre Poster Archive. {first.get('performance_date', '')}. "
                    f"Source image {source_file}. Accession {first.get('accession_id', '')}."
                ),
            }
        )

    return posters


def build_poster_semantic_text(poster: dict[str, Any]) -> str:
    excerpt = " ".join(poster["extracted_text"].split())[:1400]
    entities = ", ".join(poster["entities"][:12])
    return ". ".join(
        [
            f"Date: {poster['performance_date']}",
            f"Source file: {poster['source_file']}",
            f"Acts and performers: {entities}",
            f"Extracted text: {excerpt}",
        ]
    ) 


def seed_staff_archive() -> None:
    archive_records = build_posters()
    with get_staff_db() as connection:
        for poster in archive_records:
            existing = connection.execute(
                "SELECT id FROM staff_posters WHERE source_file = ? LIMIT 1",
                (poster["source_file"],),
            ).fetchone()
            if existing:
                continue

            connection.execute(
                """
                INSERT INTO staff_posters (
                    title, performance_date, categories, entities, extracted_text, citation, accession_id, act_count, source_file, image_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    poster["title"],
                    poster["performance_date"],
                    derive_categories(poster),
                    ", ".join(poster["entities"]),
                    poster["extracted_text"],
                    poster["citation"],
                    poster["accession_id"],
                    poster["act_count"],
                    poster["source_file"],
                    poster["image_path"],
                ),
            )
        connection.commit()


def load_archive_posters_from_db() -> list[dict[str, Any]]:
    with get_staff_db() as connection:
        rows = connection.execute(
            """
            SELECT id, title, performance_date, categories, entities, extracted_text, citation,
                   accession_id, act_count, source_file, image_path, created_at
            FROM staff_posters
            ORDER BY id ASC
            """
        ).fetchall()

    posters: list[dict[str, Any]] = []
    for row in rows:
        entities = [item.strip() for item in str(row["entities"] or "").split(",") if item.strip()]
        posters.append(
            {
                "id": str(row["id"]),
                "db_id": row["id"],
                "title": row["title"],
                "performance_date": row["performance_date"],
                "categories": row["categories"],
                "entities": entities,
                "extracted_text": row["extracted_text"],
                "citation": row["citation"],
                "accession_id": row["accession_id"],
                "act_count": int(row["act_count"] or 0),
                "source_file": row["source_file"],
                "image_path": row["image_path"],
                "created_at": row["created_at"],
            }
        )
    return posters


def search_staff_posters(query: str, category: str = "") -> list[dict[str, Any]]:
    normalized_query = query.strip()
    normalized_category = category.strip()
    conditions: list[str] = []
    parameters: list[str] = []

    if normalized_query:
        like = f"%{normalized_query}%"
        conditions.append(
            """
            (
                title LIKE ?
                OR performance_date LIKE ?
                OR categories LIKE ?
                OR entities LIKE ?
                OR extracted_text LIKE ?
                OR citation LIKE ?
                OR source_file LIKE ?
            )
            """
        )
        parameters.extend([like, like, like, like, like, like, like])

    if normalized_category:
        category_like = f"%{normalized_category}%"
        conditions.append("(categories LIKE ? OR entities LIKE ? OR extracted_text LIKE ?)")
        parameters.extend([category_like, category_like, category_like])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, title, performance_date, categories, entities, extracted_text, citation, accession_id, act_count, source_file, image_path, created_at
        FROM staff_posters
        {where_clause}
        ORDER BY created_at DESC, id DESC
        LIMIT 50
    """

    with get_staff_db() as connection:
        rows = connection.execute(sql, parameters).fetchall()

    records = []
    for row in rows:
        records.append(
            {
                "id": row["id"],
                "title": row["title"],
                "performance_date": row["performance_date"],
                "categories": row["categories"],
                "entities": [item.strip() for item in row["entities"].split(",") if item.strip()],
                "extracted_text": row["extracted_text"],
                "citation": row["citation"],
                "accession_id": row["accession_id"],
                "act_count": int(row["act_count"] or 0),
                "source_file": row["source_file"],
                "image_path": row["image_path"],
                "created_at": row["created_at"],
            }
        )
    return records


def insert_staff_poster(payload: dict[str, Any]) -> dict[str, Any]:
    image_name = slugify_filename(str(payload.get("image_name", "poster-upload.png")))
    title = str(payload.get("title", "")).strip()
    if not title:
        title = Path(image_name).stem.replace("-", " ").replace("_", " ").strip() or "Uploaded poster"
    image_data = str(payload.get("image_data", "")).strip()
    image_path = ""

    if image_data:
        if "," in image_data:
            _, encoded = image_data.split(",", 1)
        else:
            encoded = image_data
        binary = base64.b64decode(encoded)
        target = UPLOADS_DIR / image_name
        suffix = 1
        while target.exists():
            target = UPLOADS_DIR / f"{target.stem}-{suffix}{target.suffix}"
            suffix += 1
        target.write_bytes(binary)
        image_path = str(target.relative_to(ROOT)).replace("\\", "/")

    record = {
        "title": title,
        "performance_date": str(payload.get("performance_date", "")).strip(),
        "categories": str(payload.get("categories", "")).strip(),
        "entities": str(payload.get("entities", "")).strip(),
        "extracted_text": str(payload.get("extracted_text", "")).strip(),
        "citation": str(payload.get("citation", "")).strip(),
        "accession_id": str(payload.get("accession_id", "")).strip(),
        "act_count": int(payload.get("act_count", 0) or 0),
        "source_file": str(payload.get("source_file", image_name)).strip(),
        "image_path": image_path,
    }

    with get_staff_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO staff_posters (
                title, performance_date, categories, entities, extracted_text, citation, accession_id, act_count, source_file, image_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["title"],
                record["performance_date"],
                record["categories"],
                record["entities"],
                record["extracted_text"],
                record["citation"],
                record["accession_id"],
                record["act_count"],
                record["source_file"],
                record["image_path"],
            ),
        )
        connection.commit()
        record_id = cursor.lastrowid

    with get_staff_db() as connection:
        row = connection.execute(
            """
            SELECT id, title, performance_date, categories, entities, extracted_text, citation, accession_id, act_count, source_file, image_path, created_at
            FROM staff_posters
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()

    if not row:
        return record

    return {
        "id": row["id"],
        "title": row["title"],
        "performance_date": row["performance_date"],
        "categories": row["categories"],
        "entities": [item.strip() for item in row["entities"].split(",") if item.strip()],
        "extracted_text": row["extracted_text"],
        "citation": row["citation"],
        "accession_id": row["accession_id"],
        "act_count": int(row["act_count"] or 0),
        "source_file": row["source_file"],
        "image_path": row["image_path"],
        "created_at": row["created_at"],
    }


@dataclass
class SearchResponse:
    mode: str
    records: list[dict[str, Any]]
    reason: str = ""
    debug: str = ""


class HybridSearchEngine:
    def __init__(self) -> None:
        self.embedding_cache: dict[str, list[float]] = {}
        self.lock = threading.Lock()
        self.embeddings_ready = False
        self.posters: list[dict[str, Any]] = []
        self.poster_text: dict[str, str] = {}
        self.poster_lookup: dict[str, dict[str, Any]] = {}
        self.load_cached_embeddings()
        self.refresh_posters()

    def refresh_posters(self) -> None:
        self.posters = load_archive_posters_from_db()
        self.poster_text = {poster["id"]: build_poster_semantic_text(poster) for poster in self.posters}
        self.poster_lookup = {poster["id"]: poster for poster in self.posters}
        self.embedding_cache = {
            key: vector for key, vector in self.embedding_cache.items() if key in self.poster_lookup
        }
        self.embeddings_ready = len(self.posters) > 0 and len(self.embedding_cache) == len(self.posters)

    def load_cached_embeddings(self) -> None:
        if not EMBED_CACHE_PATH.exists():
            return

        try:
            payload = json.loads(EMBED_CACHE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return

        if payload.get("model") != EMBED_MODEL:
            return

        embeddings = payload.get("embeddings")
        if not isinstance(embeddings, dict):
            return

        self.embedding_cache = {
            key: [float(value) for value in vector]
            for key, vector in embeddings.items()
            if isinstance(vector, list)
        }
        self.embeddings_ready = len(self.embedding_cache) == len(self.posters)

    def save_cached_embeddings(self) -> None:
        payload = {"model": EMBED_MODEL, "embeddings": self.embedding_cache}
        EMBED_CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")

    def ollama_embed(self, text: str) -> list[float]:
        payload = {"model": EMBED_MODEL, "input": text}
        for url in ("http://127.0.0.1:11434/api/embed", "http://127.0.0.1:11434/api/embeddings"):
            try:
                response = post_json(url, payload, timeout=60)
            except Exception as error:
                print(f"[embed] failed {url}: {error}")
                continue

            if "embeddings" in response and response["embeddings"]:
                return [float(value) for value in response["embeddings"][0]]
            if "embedding" in response and response["embedding"]:
                return [float(value) for value in response["embedding"]]

        raise RuntimeError("Unable to fetch embeddings from Ollama")

    def ensure_embeddings(self) -> None:
        with self.lock:
            if self.embeddings_ready:
                return

            for poster in self.posters:
                poster_id = poster["id"]
                if poster_id in self.embedding_cache:
                    continue
                self.embedding_cache[poster_id] = self.ollama_embed(self.poster_text[poster_id])

            self.embeddings_ready = True
            self.save_cached_embeddings()

    def semantic_results(self, query: str) -> list[dict[str, Any]]:
        self.ensure_embeddings()
        query_vector = self.ollama_embed(query.strip())

        results = []
        for poster in self.posters:
            vector = self.embedding_cache.get(poster["id"], [])
            score = cosine_similarity(query_vector, vector)
            if score > EMBED_THRESHOLD:
                results.append({**poster, "semantic_score": score})

        results.sort(key=lambda item: item["semantic_score"], reverse=True)
        return results[:SEMANTIC_RESULTS_LIMIT]

    def semantic_search(self, query: str) -> SearchResponse:
        normalized = query.strip()
        if not normalized:
            return SearchResponse(mode="idle", records=[])

        try:
            candidates = self.semantic_results(normalized)
            if not candidates:
                return SearchResponse(mode="semantic", records=[], debug="No semantic candidates returned")

            final_records = []
            for candidate in candidates[:SEMANTIC_RESULTS_LIMIT]:
                final_records.append(
                    {
                        **candidate,
                        "query_score": round(candidate.get("semantic_score", 0.0), 4),
                    }
                )

            return SearchResponse(
                mode="semantic",
                records=final_records,
                debug="Semantic embedding fallback returned related archive posters",
            )
        except Exception as error:
            print(f"[search] semantic fallback failed for query '{normalized}': {error}")
            traceback.print_exc()
            return SearchResponse(
                mode="semantic",
                reason="Semantic embeddings were unavailable.",
                records=[],
                debug=f"{type(error).__name__}: {error}",
            )


init_staff_db()
seed_staff_archive()
ENGINE = HybridSearchEngine()


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/search":
            params = urllib.parse.parse_qs(parsed.query)
            query = params.get("q", [""])[0]
            category = params.get("category", [""])[0]
            records = search_staff_posters(query, category)
            if records:
                self.send_json(
                    200,
                    {
                        "mode": "sql",
                        "records": records,
                        "count": len(records),
                    },
                )
                return

            result = ENGINE.semantic_search(query)
            self.send_json(
                200,
                {
                    "mode": result.mode,
                    "reason": result.reason,
                    "debug": result.debug,
                    "records": result.records,
                    "count": len(result.records),
                },
            )
            return

        if parsed.path == "/api/staff/search":
            params = urllib.parse.parse_qs(parsed.query)
            query = params.get("q", [""])[0]
            category = params.get("category", [""])[0]
            records = search_staff_posters(query, category)
            self.send_json(
                200,
                {
                    "mode": "sql",
                    "records": records,
                    "count": len(records),
                },
            )
            return

        if parsed.path == "/":
            self.path = "/index.html"
        elif parsed.path == "/staff":
            self.path = "/staff.html"

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/staff/posters":
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            try:
                payload = json.loads(raw.decode("utf-8"))
                record = insert_staff_poster(payload)
                ENGINE.refresh_posters()
            except Exception as error:
                self.send_json(400, {"error": str(error)})
                return

            self.send_json(201, {"record": record})
            return

        self.send_json(404, {"error": "Not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()
