import io
import math
from datetime import datetime

import joblib
import librosa
import numpy as np
import pandas as pd

import analytics
import degradation
import storage
from audio import read_audio, read_table
from config import CHANNELS, MAX_RECORDING_SEC, MODEL_PATH, N_MELS, SEG_SEC, SR, SUBF_SR
from inference import analyse

_bundle = {"mtime": None, "data": None}


def load_bundle():
    if not MODEL_PATH.exists():
        return None
    mtime = MODEL_PATH.stat().st_mtime
    if _bundle["mtime"] != mtime:
        _bundle["data"] = joblib.load(MODEL_PATH)
        _bundle["mtime"] = mtime
    return _bundle["data"]


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return value


def read_signals(data, name, rate=SUBF_SR):
    source = io.BytesIO(data)
    if name.lower().endswith(".csv"):
        signals = [read_table(source, rate)]
    else:
        signals = read_audio(source, CHANNELS)
    if len(signals[0]) < SR * 0.5:
        raise ValueError("The recording is shorter than half a second.")
    if len(signals[0]) / SR > MAX_RECORDING_SEC:
        raise ValueError(f"Recordings longer than {MAX_RECORDING_SEC} seconds are not supported.")
    return signals


def waveform(signal, buckets=700):
    count = min(buckets, len(signal))
    edges = np.linspace(0, len(signal), count + 1).astype(int)
    out = []
    for i in range(count):
        part = signal[edges[i]:max(edges[i + 1], edges[i] + 1)]
        out.append([round(float(i * len(signal) / SR / count), 4), round(float(part.min()), 5),
                    round(float(part.max()), 5)])
    return out


def spectrogram(signal, columns=120):
    mel = librosa.feature.melspectrogram(y=signal, sr=SR, n_fft=1024, hop_length=512, n_mels=N_MELS)
    db = librosa.power_to_db(mel + 1e-10, ref=np.max)
    groups = np.array_split(np.arange(db.shape[1]), min(columns, db.shape[1]))
    grid = np.stack([db[:, g].mean(axis=1) for g in groups], axis=1)
    return {
        "values": np.round(grid, 1).tolist(),
        "duration": float(len(signal) / SR),
        "fmax": SR / 2,
        "min": float(grid.min()),
        "max": float(grid.max()),
    }


def context(owner_id, machine_id, result, model_id):
    base = storage.get_baseline(owner_id, machine_id, model_id)
    prev = storage.readings(owner_id, machine_id, model_id)
    if base is not None:
        prev = prev[prev["recorded_at"] >= pd.Timestamp(base["created"])].reset_index(drop=True)
    trend_info = analytics.trend(list(prev["health"]) + [result["health"]])
    comparison = analytics.compare(result, prev, base["profile"] if base is not None else None,
                                  base["health"] if base is not None else None)
    alert_list = analytics.alerts(prev, trend_info, comparison)

    public = {"trend": trend_info, "alerts": list(alert_list), "ideal": None, "degradation": None,
              "comparison": None}
    internal = {"prev": prev, "comparison": comparison, "trend": trend_info, "alerts": alert_list,
                "ideal_info": None}
    if comparison is not None:
        public["comparison"] = {
            "readings_used": comparison["readings_used"],
            "baseline_health": comparison["baseline_health"],
            "health_change": comparison["health_change"],
            "changes": analytics.describe_changes(comparison),
            "baseline_profile": [round(float(v), 2) for v in comparison["baseline_profile"]],
        }
    if base is not None:
        lim = degradation.limits(base.get("spread"))
        pct = degradation.degradation_pct(base["health"], result["health"])
        shift = degradation.spectral_shift_pct(base["profile"], result["profile"])
        r2 = degradation.r2_value(base["profile"], result["profile"])
        r2_pct = degradation.r2_degradation_pct(base["profile"], result["profile"])
        series = degradation.r2_series(base["profile"], prev["profile"]) if len(prev) else []
        times = ((prev["recorded_at"] - prev["recorded_at"].iloc[0]).dt.total_seconds() / 86400
                 if len(prev) else [])
        eta = degradation.days_to_boundary(times, list(prev["health"])) if len(prev) else None
        public["ideal"] = {"health": base["health"], "clips": base["clips"], "created": base["created"],
                           "profile": [round(float(v), 2) for v in base["profile"]]}
        public["degradation"] = {
            "pct": pct, "grade": degradation.grade(pct), "shift": shift, "r2": r2, "r2_pct": r2_pct,
            "condition": degradation.r2_condition(r2, lim), "series": series,
            "series_trend": degradation.trend_info(series + ([r2_pct] if r2_pct is not None else [])),
            "alerts": degradation.degradation_alerts(series, r2_pct if r2_pct is not None else 0.0, lim),
            "days_to_boundary": eta, "watch_pct": lim[0], "degraded_pct": lim[1],
            "natural_spread": max(base["spread"]) if base.get("spread") else None,
        }
        internal["ideal_info"] = {
            "health": base["health"], "clips": base["clips"], "created": base["created"], "r2": r2,
            "r2_pct": r2_pct, "shift": shift, "prev_pct": series,
            "condition": degradation.r2_condition(r2, lim), "limits": lim,
        }
    return public, internal


def result_json(result):
    skip = {"segment_scores", "segment_flags", "segment_times", "checks"}
    data = {k: v for k, v in result.items() if k not in skip}
    data["segments_detail"] = [
        {"start": float(t), "end": float(t + SEG_SEC), "score": float(s), "flagged": bool(f)}
        for t, s, f in zip(result["segment_times"], result["segment_scores"], result["segment_flags"])
    ]
    data["checks"] = [{"name": n, "passed": bool(ok), "detail": d} for n, ok, d in result["checks"]]
    return clean(data)


def profile_axis():
    return [round(float(v)) for v in analytics.CENTERS]


def history_rows(frame, current_model):
    rows = []
    for r in frame.itertuples():
        rows.append({
            "id": int(r.id), "recorded_at": r.recorded_at.strftime("%Y-%m-%d %H:%M"),
            "file_name": r.file_name, "status": r.status, "level": r.level,
            "health": float(r.health), "score": float(r.score), "threshold": float(r.threshold),
            "flag_ratio": float(r.flag_ratio), "reliable": bool(r.reliable),
            "current_model": r.model_id == current_model, "has_recording": bool(r.file_path),
        })
    return rows
