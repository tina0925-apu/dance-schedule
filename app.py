import json
import os
import secrets
from datetime import timedelta

import sqlite3
from flask import Flask, request, jsonify, render_template, g, session

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me-before-deploying")
app.permanent_session_lifetime = timedelta(days=365)

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


@app.before_request
def ensure_device_id():
    # Every visitor gets a long-lived, silent "device id" cookie so we can
    # remember which sessions they created, with no login screen at all.
    session.permanent = True
    if "device_id" not in session:
        session["device_id"] = secrets.token_urlsafe(16)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (code TEXT PRIMARY KEY, data TEXT NOT NULL, owner_device TEXT)"
    )
    cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
    if "owner_device" not in cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN owner_device TEXT")
    conn.commit()
    conn.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/my-sessions")
def my_sessions():
    device_id = session.get("device_id")
    db = get_db()
    rows = db.execute(
        "SELECT code, data FROM sessions WHERE owner_device = ? ORDER BY rowid DESC",
        (device_id,),
    ).fetchall()
    result = []
    for code, data_json in rows:
        try:
            d = json.loads(data_json)
            event_name = d.get("eventName") or code
        except Exception:
            event_name = code
        result.append({"code": code, "eventName": event_name})
    return jsonify(result)


@app.route("/api/session/<code>", methods=["GET"])
def get_session(code):
    db = get_db()
    row = db.execute("SELECT data FROM sessions WHERE code = ?", (code,)).fetchone()
    if row is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify(json.loads(row[0]))


SETUP_FIELDS = ["eventName", "dates", "people", "startDate", "endDate", "excludedDates"]


@app.route("/api/session/<code>", methods=["POST"])
def save_session(code):
    """Create a session, or update its SETUP fields only (dates/people/name).
    Other people's responses already stored on the server are never overwritten."""
    payload = request.get_json(force=True, silent=True)
    if payload is None:
        return jsonify({"error": "invalid_json"}), 400
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT data FROM sessions WHERE code = ?", (code,)).fetchone()
    if row is None:
        merged = payload
        merged.setdefault("responses", {})
        merged.setdefault("sidecam", {})
        db.execute(
            "INSERT INTO sessions (code, data, owner_device) VALUES (?, ?, ?)",
            (code, json.dumps(merged, ensure_ascii=False), session.get("device_id")),
        )
    else:
        merged = json.loads(row[0])
        for f in SETUP_FIELDS:
            if f in payload:
                merged[f] = payload[f]
        people = set(merged.get("people", []))
        merged["responses"] = {k: v for k, v in merged.get("responses", {}).items() if k in people}
        merged["sidecam"] = {k: v for k, v in merged.get("sidecam", {}).items() if k in people}
        db.execute(
            "UPDATE sessions SET data = ? WHERE code = ?",
            (json.dumps(merged, ensure_ascii=False), code),
        )
    db.commit()
    return jsonify(merged)


@app.route("/api/session/<code>/response", methods=["POST"])
def save_response(code):
    """Save ONE person's answers. Only that person's entry is touched, so
    several people can fill in at the same time without overwriting each other."""
    payload = request.get_json(force=True, silent=True) or {}
    person = payload.get("person")
    if not person:
        return jsonify({"error": "missing_person"}), 400
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    row = db.execute("SELECT data FROM sessions WHERE code = ?", (code,)).fetchone()
    if row is None:
        db.rollback()
        return jsonify({"error": "not_found"}), 404
    data = json.loads(row[0])
    if person not in data.get("people", []):
        db.rollback()
        return jsonify({"error": "unknown_person"}), 400
    data.setdefault("responses", {})[person] = payload.get("responses", {})
    data.setdefault("sidecam", {})[person] = payload.get("sidecam", "")
    db.execute(
        "UPDATE sessions SET data = ? WHERE code = ?",
        (json.dumps(data, ensure_ascii=False), code),
    )
    db.commit()
    return jsonify(data)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
else:
    init_db()

