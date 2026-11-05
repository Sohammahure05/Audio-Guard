import io
import json
import os
import re
import secrets
import time
import uuid
import wave
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import analytics
import auth
import service
import storage
from config import (EVAL_PATH, MACHINES, MAX_UPLOAD_MB, MIN_IDEAL_CLIPS, SAVE_UPLOADS, SR, STORAGE_DIR,
                    SUBF_SR, TOKEN_HOURS, UPLOAD_DIR)
from inference import analyse
from report import build_pdf, load_reference

BASE = Path(__file__).resolve().parent
DIST = BASE / "frontend" / "dist"
ALLOWED = (".wav", ".flac", ".ogg", ".mp3", ".csv")
MAX_BATCH = 10
CACHE_LIMIT = 40
CACHE_SECONDS = 3600

@asynccontextmanager
async def lifespan(_):
    storage.init()
    yield


app = FastAPI(title="Audio Guard API", docs_url="/api/docs", openapi_url="/api/openapi.json",
              lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("MH_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"], allow_headers=["*"],
)
bearer = HTTPBearer(auto_error=False)
analyses = {}


def secret():
    if os.environ.get("MH_SECRET"):
        return os.environ["MH_SECRET"]
    path = STORAGE_DIR / "secret.key"
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


SECRET = secret()


def make_token(user):
    payload = {"sub": str(user["id"]), "usr": user["username"], "company": user["company"],
               "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)}
    return jwt.encode(payload, SECRET, algorithm="HS256")


def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Not signed in.")
    try:
        data = jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    user = storage.get_user(data["usr"])
    if user is None or str(user["id"]) != data["sub"]:
        raise HTTPException(401, "Account not found.")
    return {"id": user["id"], "username": user["username"], "company": user["company"]}


def need_bundle():
    bundle = service.load_bundle()
    if bundle is None:
        raise HTTPException(503, "No trained model found. Run train.py first.")
    return bundle


def need_machine(user, machine_id):
    machine = storage.get_machine(user["id"], machine_id)
    if machine is None:
        raise HTTPException(404, "Machine not found.")
    return machine


def entry_for(bundle, machine):
    entry = bundle["machines"].get(machine["type"])
    if entry is None:
        raise HTTPException(400, f"No trained model for machine type '{machine['type']}'.")
    return entry


async def read_upload(upload: UploadFile):
    name = re.split(r"[\\/]", upload.filename or "recording")[-1].strip() or "recording"
    if not name.lower().endswith(ALLOWED):
        raise HTTPException(415, f"{name}: unsupported file type. Use wav, flac, ogg, mp3 or csv.")
    data = await upload.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"{name}: file is larger than {MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(400, f"{name}: the file is empty.")
    return name, data


def run_analysis(name, data, rate, entry):
    try:
        signals = service.read_signals(data, name, rate)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(422, f"{name}: could not read the recording ({error}).")
    return signals, analyse(signals, entry)


def remember(user, machine, name, data, rate, signals, result, public, internal):
    now = time.time()
    for key in [k for k, v in analyses.items() if now - v["time"] > CACHE_SECONDS]:
        analyses.pop(key, None)
    while len(analyses) >= CACHE_LIMIT:
        analyses.pop(min(analyses, key=lambda k: analyses[k]["time"]))
    key = uuid.uuid4().hex
    analyses[key] = {"user": user["id"], "machine": machine, "name": name, "data": data, "rate": rate,
                     "signals": signals, "result": result, "public": public, "internal": internal,
                     "time": now, "saved": False}
    return key


def get_analysis(user, key):
    item = analyses.get(key)
    if item is None or item["user"] != user["id"]:
        raise HTTPException(404, "This analysis has expired. Upload the recording again.")
    return item


def save_item(user, item, model_id):
    path = None
    if SAVE_UPLOADS:
        path = storage.save_upload(user["id"], item["machine"]["id"], item["name"], item["data"])
    storage.add_reading(user["id"], item["machine"]["id"], item["name"], path, item["result"], model_id)
    item["saved"] = True


class Credentials(BaseModel):
    username: str
    password: str


class Registration(Credentials):
    company: str


class MachineIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    type: str
    location: str = ""
    notes: str = ""


@app.get("/api/health")
def health():
    return {"status": "ok", "model": service.load_bundle() is not None}


@app.post("/api/auth/register", status_code=201)
def register(body: Registration):
    if os.environ.get("MH_ALLOW_REGISTER", "1") == "0":
        raise HTTPException(403, "Registration is disabled on this server.")
    ok, message = auth.register(body.username, body.password, body.company)
    if not ok:
        raise HTTPException(400, message)
    return {"message": message}


@app.post("/api/auth/login")
def login(body: Credentials):
    user, message = auth.authenticate(body.username, body.password)
    if user is None:
        raise HTTPException(429 if message.startswith("Too many") else 401, message)
    return {"token": make_token(user), "user": user}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return user


@app.get("/api/model")
def model_info(user=Depends(current_user)):
    bundle = service.load_bundle()
    if bundle is None:
        return {"ready": False}
    evaluation = json.loads(EVAL_PATH.read_text()) if EVAL_PATH.exists() else None
    machines = {}
    for name, entry in bundle["machines"].items():
        machines[name] = {
            "threshold": entry["threshold"], "pooling": entry["pooling"], "train_ids": entry["train_ids"],
            "novelty_limit": entry["novelty_limit"], "ood_limit": entry["ood_limit"],
            "calibration": entry["calibration"],
        }
    return service.clean({"ready": True, "info": bundle["info"], "machines": machines,
                          "evaluation": evaluation, "profile_axis": service.profile_axis()})


@app.get("/api/machines")
def machines(user=Depends(current_user)):
    frame = storage.list_machines(user["id"])
    current = (service.load_bundle() or {}).get("info", {}).get("trained_at")
    rows = []
    for m in frame.itertuples():
        history = storage.readings(user["id"], m.id)
        last = history.iloc[-1] if len(history) else None
        rows.append({
            "id": int(m.id), "code": m.code, "name": m.name, "type": m.type, "location": m.location or "",
            "notes": m.notes or "", "created": m.created, "readings": int(len(history)),
            "last_reading": last["recorded_at"].strftime("%Y-%m-%d %H:%M") if last is not None else None,
            "last_status": last["status"] if last is not None else None,
            "last_level": last["level"] if last is not None else None,
            "last_health": round(float(last["health"])) if last is not None else None,
            "has_ideal": current is not None and storage.get_baseline(user["id"], int(m.id), current) is not None,
        })
    return rows


def validate_type(mtype):
    bundle = service.load_bundle()
    allowed = list(bundle["machines"]) if bundle else MACHINES
    if mtype not in allowed:
        raise HTTPException(400, f"Machine type must be one of: {', '.join(allowed)}.")


@app.post("/api/machines", status_code=201)
def add_machine(body: MachineIn, user=Depends(current_user)):
    validate_type(body.type)
    if not storage.add_machine(user["id"], body.code.strip(), body.name.strip(), body.type,
                               body.location.strip(), body.notes.strip()):
        raise HTTPException(409, "You already have a machine with that number.")
    return {"message": "Machine added."}


@app.put("/api/machines/{machine_id}")
def edit_machine(machine_id: int, body: MachineIn, user=Depends(current_user)):
    need_machine(user, machine_id)
    validate_type(body.type)
    if not storage.update_machine(user["id"], machine_id, body.code.strip(), body.name.strip(), body.type,
                                  body.location.strip(), body.notes.strip()):
        raise HTTPException(409, "You already have a machine with that number.")
    return {"message": "Machine updated."}


@app.delete("/api/machines/{machine_id}")
def remove_machine(machine_id: int, user=Depends(current_user)):
    need_machine(user, machine_id)
    storage.delete_machine(user["id"], machine_id)
    return {"message": "Machine removed."}


@app.get("/api/dashboard")
def dashboard(user=Depends(current_user)):
    fleet = machines(user)
    recent = storage.recent_readings(user["id"], 300)
    today = datetime.now().strftime("%Y-%m-%d")
    stamps = pd.to_datetime(recent["recorded_at"]) if len(recent) else pd.Series(dtype="datetime64[ns]")
    days = [(datetime.now() - timedelta(days=d)).strftime("%Y-%m-%d") for d in range(13, -1, -1)]
    counts = stamps.dt.strftime("%Y-%m-%d").value_counts() if len(recent) else pd.Series(dtype=int)
    attention = [m for m in fleet if m["last_level"] in ("Watch", "Maintenance required", "Critical")]
    levels = {}
    for m in fleet:
        levels[m["last_level"] or "No reading"] = levels.get(m["last_level"] or "No reading", 0) + 1
    alerts = []
    for m in attention:
        alerts.append({"machine_id": m["id"], "code": m["code"], "name": m["name"], "level": m["last_level"],
                       "health": m["last_health"], "when": m["last_reading"]})
    order = {"Critical": 0, "Maintenance required": 1, "Watch": 2}
    alerts.sort(key=lambda a: order[a["level"]])
    return service.clean({
        "totals": {"machines": len(fleet), "readings": int(len(recent)),
                   "today": int((stamps.dt.strftime("%Y-%m-%d") == today).sum()) if len(recent) else 0,
                   "attention": len(attention), "with_ideal": sum(1 for m in fleet if m["has_ideal"])},
        "levels": levels, "fleet": fleet, "alerts": alerts,
        "activity": [{"day": d[5:], "readings": int(counts.get(d, 0))} for d in days],
        "recent": [{"id": int(r.id), "machine_id": int(r.machine_id), "code": r.machine_code,
                    "name": r.machine_name, "when": r.recorded_at, "status": r.status, "level": r.level,
                    "health": float(r.health), "file_name": r.file_name}
                   for r in recent.head(8).itertuples()],
    })


@app.post("/api/machines/{machine_id}/analyse")
async def analyse_recording(machine_id: int, file: UploadFile = File(...), csv_rate: int = Form(SUBF_SR),
                            user=Depends(current_user)):
    bundle = need_bundle()
    machine = need_machine(user, machine_id)
    entry = entry_for(bundle, machine)
    name, data = await read_upload(file)
    signals, result = run_analysis(name, data, csv_rate, entry)
    model_id = bundle["info"]["trained_at"]
    public, internal = service.context(user["id"], machine_id, result, model_id)
    key = remember(user, machine, name, data, csv_rate, signals, result, public, internal)
    return service.clean({
        "analysis_id": key, "file_name": name, "machine": machine,
        "result": service.result_json(result), **public,
        "profile_axis": service.profile_axis(),
        "waveform": service.waveform(signals[0]), "spectrogram": service.spectrogram(signals[0]),
        "can_save": True,
    })


@app.post("/api/analyses/{key}/save")
def save_analysis(key: str, user=Depends(current_user)):
    bundle = need_bundle()
    item = get_analysis(user, key)
    if item["saved"]:
        raise HTTPException(409, "This recording is already saved to the machine's history.")
    save_item(user, item, bundle["info"]["trained_at"])
    return {"message": "Reading saved to history."}


@app.get("/api/analyses/{key}/report.pdf")
def analysis_pdf(key: str, user=Depends(current_user)):
    item = get_analysis(user, key)
    m = item["machine"]
    meta = {"code": m["code"], "name": m["name"], "type": m["type"], "location": m["location"],
            "file": item["name"], "time": datetime.now().strftime("%Y-%m-%d %H:%M")}
    pdf = build_pdf(item["result"], item["signals"][0], meta, load_reference(m["type"]),
                    {k: item["internal"][k] for k in ("prev", "comparison", "trend", "alerts")},
                    item["internal"]["ideal_info"])
    stem = os.path.splitext(item["name"])[0]
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="report_{m["code"]}_{stem}.pdf"'})


@app.get("/api/analyses/{key}/audio.wav")
def analysis_audio(key: str, user=Depends(current_user)):
    item = get_analysis(user, key)
    signal = np.asarray(item["signals"][0], dtype=np.float64)
    peak = float(np.max(np.abs(signal))) if len(signal) else 0.0
    if peak > 0:
        signal = signal / peak * 0.9
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes((signal * 32767).astype("<i2").tobytes())
    return Response(buffer.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.post("/api/batch/analyse")
async def batch_analyse(files: list[UploadFile] = File(...), machine_ids: list[int] = Form(...),
                        user=Depends(current_user)):
    bundle = need_bundle()
    if len(files) != len(machine_ids):
        raise HTTPException(400, "Each file needs a machine.")
    if len(files) > MAX_BATCH:
        raise HTTPException(400, f"Upload at most {MAX_BATCH} recordings at a time.")
    model_id = bundle["info"]["trained_at"]
    rows = []
    for upload, machine_id in zip(files, machine_ids):
        machine = need_machine(user, machine_id)
        entry = entry_for(bundle, machine)
        name, data = await read_upload(upload)
        try:
            signals, result = run_analysis(name, data, SUBF_SR, entry)
        except HTTPException as error:
            rows.append({"file_name": name, "machine_id": machine_id, "machine_code": machine["code"],
                         "error": error.detail})
            continue
        public, internal = service.context(user["id"], machine_id, result, model_id)
        key = remember(user, machine, name, data, SUBF_SR, signals, result, public, internal)
        degr = public["degradation"]
        rows.append({
            "analysis_id": key, "file_name": name, "machine_id": machine_id, "machine_code": machine["code"],
            "status": result["status"], "level": result["level"], "health": result["health"],
            "score": result["score"], "reliable": result["reliable"],
            "degradation_pct": degr["r2_pct"] if degr else None,
            "condition": degr["condition"] if degr else "No ideal",
            "ideal_health": public["ideal"]["health"] if public["ideal"] else None,
        })
    return service.clean({"rows": rows})


class SaveMany(BaseModel):
    ids: list[str]


@app.post("/api/analyses/save")
def save_many(body: SaveMany, user=Depends(current_user)):
    bundle = need_bundle()
    saved = 0
    for key in body.ids:
        item = get_analysis(user, key)
        if not item["saved"]:
            save_item(user, item, bundle["info"]["trained_at"])
            saved += 1
    return {"message": f"{saved} reading(s) saved.", "saved": saved}


@app.post("/api/machines/{machine_id}/ideal")
async def build_ideal(machine_id: int, files: list[UploadFile] = File(...), user=Depends(current_user)):
    bundle = need_bundle()
    machine = need_machine(user, machine_id)
    entry = entry_for(bundle, machine)
    if len(files) < MIN_IDEAL_CLIPS:
        raise HTTPException(400, f"Use at least {MIN_IDEAL_CLIPS} healthy clips to build a stable ideal.")
    if len(files) > MAX_BATCH:
        raise HTTPException(400, f"Use at most {MAX_BATCH} clips.")
    results, names = [], []
    for upload in files:
        name, data = await read_upload(upload)
        _, result = run_analysis(name, data, SUBF_SR, entry)
        results.append(result)
        names.append(name)
    bad = [n for n, r in zip(names, results) if r["status"] != "Normal"]
    if bad:
        raise HTTPException(422, "These clips were classified as abnormal, so the machine may not be "
                                 "healthy. They cannot be used as its ideal: " + ", ".join(bad))
    profile = np.mean([np.asarray(r["profile"], float) for r in results], axis=0)
    health = float(np.mean([r["health"] for r in results]))
    from degradation import r2_degradation_pct
    arrays = [np.asarray(r["profile"], float) for r in results]
    spread = [r2_degradation_pct(np.mean(arrays[:i] + arrays[i + 1:], axis=0), arrays[i]) or 0.0 for i in range(len(arrays))]
    storage.set_baseline(user["id"], machine_id, health, profile, len(results), bundle["info"]["trained_at"], spread=spread)
    return service.clean({"message": "Ideal saved.", "clips": len(results), "health": health, "natural_spread": max(spread),
                          "clip_health": [{"file_name": n, "health": r["health"]} for n, r in zip(names, results)]})


@app.get("/api/machines/{machine_id}/ideal")
def get_ideal(machine_id: int, user=Depends(current_user)):
    need_machine(user, machine_id)
    bundle = service.load_bundle()
    ideal = storage.get_baseline(user["id"], machine_id, bundle["info"]["trained_at"]) if bundle else None
    return service.clean({"ideal": ideal, "profile_axis": service.profile_axis(), "minimum_clips": MIN_IDEAL_CLIPS})


@app.delete("/api/machines/{machine_id}/ideal")
def remove_ideal(machine_id: int, user=Depends(current_user)):
    need_machine(user, machine_id)
    storage.delete_baseline(user["id"], machine_id)
    return {"message": "Ideal removed."}


@app.get("/api/machines/{machine_id}/history")
def history(machine_id: int, since_ideal: bool = True, user=Depends(current_user)):
    machine = need_machine(user, machine_id)
    bundle = service.load_bundle()
    current = bundle["info"]["trained_at"] if bundle else None
    frame = storage.readings(user["id"], machine_id)
    ideal = storage.get_baseline(user["id"], machine_id, current) if current else None
    shown = frame[frame["model_id"] == current] if current else frame.iloc[0:0]
    if ideal is not None and since_ideal:
        shown = shown[shown["recorded_at"] >= pd.Timestamp(ideal["created"])]
    from degradation import r2_series, limits as degradation_limits
    series = r2_series(ideal["profile"], shown["profile"]) if ideal is not None and len(shown) else []
    return service.clean({
        "machine": machine, "rows": service.history_rows(frame, current),
        "trend": analytics.trend(list(shown["health"])),
        "chart": [{"n": i + 1, "id": int(r.id), "when": r.recorded_at.strftime("%Y-%m-%d %H:%M"),
                   "health": float(r.health), "score": float(r.score),
                   "degradation": series[i] if i < len(series) else None}
                  for i, r in enumerate(shown.itertuples())],
        "ideal": {"health": ideal["health"], "clips": ideal["clips"], "created": ideal["created"]} if ideal else None,
        "limits": list(degradation_limits(ideal.get("spread"))) if ideal else None,
        "older_readings": int((frame["model_id"] != current).sum()) if len(frame) else 0,
    })


@app.get("/api/machines/{machine_id}/history.csv")
def history_csv(machine_id: int, user=Depends(current_user)):
    machine = need_machine(user, machine_id)
    bundle = service.load_bundle()
    current = bundle["info"]["trained_at"] if bundle else None
    frame = storage.readings(user["id"], machine_id)
    table = pd.DataFrame(service.history_rows(frame, current))
    return Response(table.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="history_{machine["code"]}.csv"'})


@app.get("/api/readings")
def all_readings(user=Depends(current_user)):
    frame = storage.recent_readings(user["id"], 500)
    bundle = service.load_bundle()
    current = bundle["info"]["trained_at"] if bundle else None
    return service.clean([{
        "id": int(r.id), "machine_id": int(r.machine_id), "code": r.machine_code, "name": r.machine_name,
        "when": r.recorded_at, "file_name": r.file_name, "status": r.status, "level": r.level,
        "health": float(r.health), "score": float(r.score), "reliable": bool(r.reliable),
        "current_model": r.model_id == current,
    } for r in frame.itertuples()])


@app.delete("/api/readings/{reading_id}")
def delete_reading(reading_id: int, user=Depends(current_user)):
    row = storage.get_reading(user["id"], reading_id)
    if row is None:
        raise HTTPException(404, "Reading not found.")
    storage.delete_reading(user["id"], reading_id)
    if row["file_path"]:
        Path(row["file_path"]).unlink(missing_ok=True)
    return {"message": "Reading deleted."}


@app.get("/api/readings/{reading_id}/report.pdf")
def reading_pdf(reading_id: int, user=Depends(current_user)):
    bundle = need_bundle()
    row = storage.get_reading(user["id"], reading_id)
    if row is None:
        raise HTTPException(404, "Reading not found.")
    if not row["file_path"]:
        raise HTTPException(404, "The recording for this reading was not stored, so the report cannot be rebuilt.")
    folder = (UPLOAD_DIR / str(user["id"]) / str(row["machine_id"])).resolve()
    path = Path(row["file_path"]).resolve()
    if folder not in path.parents or not path.exists():
        raise HTTPException(404, "The stored recording is no longer available.")
    machine = storage.get_machine(user["id"], row["machine_id"])
    entry = entry_for(bundle, machine)
    signals, result = run_analysis(path.name, path.read_bytes(), SUBF_SR, entry)
    public, internal = service.context(user["id"], row["machine_id"], result, bundle["info"]["trained_at"])
    meta = {"code": machine["code"], "name": machine["name"], "type": machine["type"],
            "location": machine["location"], "file": row["file_name"], "time": row["recorded_at"][:16]}
    pdf = build_pdf(result, signals[0], meta, load_reference(machine["type"]),
                    {k: internal[k] for k in ("prev", "comparison", "trend", "alerts")}, internal["ideal_info"])
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="report_{machine["code"]}_{reading_id}.pdf"'})


if DIST.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (DIST / path).resolve()
        if path and DIST in target.parents and target.is_file():
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
