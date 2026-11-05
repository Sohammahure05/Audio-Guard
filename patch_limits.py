from pathlib import Path

EDITS = {
    "degradation.py": [
        ("def r2_condition(value):\n    if value is None:\n        return \"No baseline\"\n    if value >= R2_HEALTHY:\n        return \"Healthy\"\n    if value >= R2_WATCH:\n        return \"Watch\"\n    return \"Degraded\"\n",
         "def limits(spread=None):\n    default = (100 * (1 - R2_HEALTHY), 100 * (1 - R2_WATCH))\n    if not spread:\n        return default\n    top = max(spread)\n    return (max(default[0], 2.0 * top), max(default[1], 3.0 * top))\n\n\n"
         "def r2_condition(value, lim=None):\n    if value is None:\n        return \"No baseline\"\n    watch, degraded = lim or limits()\n    pct = (1 - value) * 100\n    if pct <= watch:\n        return \"Close to ideal\"\n    if pct <= degraded:\n        return \"Drifting\"\n    return \"Far from ideal\"\n"),
        ("def pct_condition(pct):\n    return r2_condition(1 - pct / 100)",
         "def pct_condition(pct, lim=None):\n    return r2_condition(1 - pct / 100, lim)"),
        ("def plot_r2_trend(ax, prev_pct, new_pct):", "def plot_r2_trend(ax, prev_pct, new_pct, lim=None):\n    lim = lim or limits()"),
        ("    ax.axhline(100 * (1 - R2_HEALTHY), color=\"orange\", linestyle=\"--\", label=\"watch limit\")\n"
         "    ax.axhline(100 * (1 - R2_WATCH), color=\"red\", linestyle=\"--\", label=\"degraded limit\")\n"
         "    ax.set_title(f\"Degradation vs ideal (R2): {new_pct:.0f}% ({pct_condition(new_pct)})\")",
         "    ax.axhline(lim[0], color=\"orange\", linestyle=\"--\", label=\"watch limit\")\n"
         "    ax.axhline(lim[1], color=\"red\", linestyle=\"--\", label=\"degraded limit\")\n"
         "    ax.set_title(f\"Degradation vs ideal (R2): {new_pct:.0f}% ({pct_condition(new_pct, lim)})\")"),
        ("def degradation_alerts(prev_pct, new_pct):", "def degradation_alerts(prev_pct, new_pct, lim=None):"),
        ("    condition = pct_condition(new_pct)\n", "    condition = pct_condition(new_pct, lim)\n"),
        ("    if condition == \"Degraded\":\n        alerts.append(f\"This reading is degraded: {new_pct:.0f}% away from the machine's ideal.\")\n    elif condition == \"Watch\":\n        alerts.append(f\"This reading is on watch: {new_pct:.0f}% away from the machine's ideal.\")\n",
         "    if condition == \"Far from ideal\":\n        alerts.append(f\"This reading sounds very different from the machine's ideal ({new_pct:.0f}% sound drift).\")\n    elif condition == \"Drifting\":\n        alerts.append(f\"This reading is drifting from the machine's ideal ({new_pct:.0f}% sound drift).\")\n"),
        ("alerts.append(f\"Degradation has risen over the last 3 readings:", "alerts.append(f\"Sound drift has risen over the last 3 readings:"),
    ],
    "storage.py": [
        ("def set_baseline(owner_id, machine_id, health, profile, clips, model_id):\n    if not owns(owner_id, machine_id):\n        raise PermissionError(\"Machine does not belong to this account\")\n    with session() as conn:\n        conn.execute(\n            \"INSERT OR REPLACE INTO baselines (machine_id, created, health, profile, clips, model_id) \"\n            \"VALUES (?, ?, ?, ?, ?, ?)\",\n            (machine_id, now(), float(health), json.dumps([float(v) for v in profile]), clips, model_id),\n        )\n",
         "def set_baseline(owner_id, machine_id, health, profile, clips, model_id, spread=None):\n    if not owns(owner_id, machine_id):\n        raise PermissionError(\"Machine does not belong to this account\")\n    with session() as conn:\n"
         "        if \"spread\" not in [row[1] for row in conn.execute(\"PRAGMA table_info(baselines)\").fetchall()]:\n"
         "            conn.execute(\"ALTER TABLE baselines ADD COLUMN spread TEXT\")\n"
         "        conn.execute(\n            \"INSERT OR REPLACE INTO baselines (machine_id, created, health, profile, clips, model_id, spread) \"\n            \"VALUES (?, ?, ?, ?, ?, ?, ?)\",\n"
         "            (machine_id, now(), float(health), json.dumps([float(v) for v in profile]), clips, model_id,\n             json.dumps([float(v) for v in spread]) if spread else None),\n        )\n"),
        ("    base[\"profile\"] = json.loads(base[\"profile\"])\n    return base",
         "    base[\"profile\"] = json.loads(base[\"profile\"])\n    base[\"spread\"] = json.loads(base[\"spread\"]) if base.get(\"spread\") else None\n    return base"),
    ],
    "service.py": [
        ("        pct = degradation.degradation_pct(base[\"health\"], result[\"health\"])\n",
         "        lim = degradation.limits(base.get(\"spread\"))\n        pct = degradation.degradation_pct(base[\"health\"], result[\"health\"])\n"),
        ("\"condition\": degradation.r2_condition(r2), \"series\": series,", "\"condition\": degradation.r2_condition(r2, lim), \"series\": series,"),
        ("degradation.degradation_alerts(series, r2_pct if r2_pct is not None else 0.0),", "degradation.degradation_alerts(series, r2_pct if r2_pct is not None else 0.0, lim),"),
        ("\"days_to_boundary\": eta,", "\"days_to_boundary\": eta, \"watch_pct\": lim[0], \"degraded_pct\": lim[1],\n            \"natural_spread\": max(base[\"spread\"]) if base.get(\"spread\") else None,"),
        ("            \"condition\": degradation.r2_condition(r2),\n        }", "            \"condition\": degradation.r2_condition(r2, lim), \"limits\": lim,\n        }"),
    ],
    "api.py": [
        ("    storage.set_baseline(user[\"id\"], machine_id, health, profile, len(results), bundle[\"info\"][\"trained_at\"])\n",
         "    from degradation import r2_degradation_pct\n    arrays = [np.asarray(r[\"profile\"], float) for r in results]\n"
         "    spread = [r2_degradation_pct(np.mean(arrays[:i] + arrays[i + 1:], axis=0), arrays[i]) or 0.0 for i in range(len(arrays))]\n"
         "    storage.set_baseline(user[\"id\"], machine_id, health, profile, len(results), bundle[\"info\"][\"trained_at\"], spread=spread)\n"),
        ("    return service.clean({\"message\": \"Ideal saved.\", \"clips\": len(results), \"health\": health,",
         "    return service.clean({\"message\": \"Ideal saved.\", \"clips\": len(results), \"health\": health, \"natural_spread\": max(spread),"),
        ("    from degradation import r2_series\n", "    from degradation import r2_series, limits as degradation_limits\n"),
        ("        \"older_readings\": int((frame[\"model_id\"] != current).sum()) if len(frame) else 0,",
         "        \"limits\": list(degradation_limits(ideal.get(\"spread\"))) if ideal else None,\n        \"older_readings\": int((frame[\"model_id\"] != current).sum()) if len(frame) else 0,"),
    ],
}

texts = {}
for name, edits in EDITS.items():
    text = Path(name).read_text(encoding="utf-8")
    for old, new in edits:
        if text.count(old) != 1:
            raise SystemExit(f"{name}: could not find this text exactly once. Nothing was changed.\n\n{old[:200]}")
        text = text.replace(old, new)
    texts[name] = text

for name, text in texts.items():
    Path(name).write_text(text, encoding="utf-8")
print("Updated:", ", ".join(texts))
