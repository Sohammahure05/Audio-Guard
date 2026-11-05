import { useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import useLoad from "../components/useLoad.js";

const TYPES = ["fan", "pump", "slider", "valve"];
const empty = { code: "", name: "", type: "fan", location: "", notes: "" };

export default function Machines() {
  const { data, error, loading, reload } = useLoad(api.machines);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    setBusy(true); setFormError("");
    try {
      await api.addMachine(form);
      setForm(empty); setOpen(false); reload();
    } catch (err) { setFormError(err.message); } finally { setBusy(false); }
  }

  async function remove(m) {
    try { await api.deleteMachine(m.id); setConfirm(null); reload(); } catch (err) { setFormError(err.message); }
  }

  return (
    <>
      <header className="page-head">
        <div><h1>Machines</h1><p className="muted">Registered machines and their latest status</p></div>
        <button className="btn primary" onClick={() => setOpen(!open)}>{open ? "Cancel" : "Add machine"}</button>
      </header>

      {open && (
        <form className="card form-grid" onSubmit={add}>
          <label>Machine number<input value={form.code} onChange={set("code")} maxLength={40} required /></label>
          <label>Name<input value={form.name} onChange={set("name")} maxLength={80} required /></label>
          <label>Type<select value={form.type} onChange={set("type")}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Location<input value={form.location} onChange={set("location")} /></label>
          <label className="wide">Notes<input value={form.notes} onChange={set("notes")} /></label>
          {formError && <div className="alert bad wide" role="alert">{formError}</div>}
          <div className="wide"><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save machine"}</button></div>
        </form>
      )}

      {!open && formError && <div className="alert bad">{formError}</div>}
      {loading && <div className="muted">Loading machines…</div>}
      {error && <div className="alert bad">{error}</div>}
      {data && data.length === 0 && <div className="card muted">No machines yet. Use “Add machine” to register one.</div>}

      <div className="grid">
        {data?.map((m) => (
          <div className="card" key={m.id}>
            <div className="row between"><strong>{m.code}</strong><Badge status={m.last_level} /></div>
            <div>{m.name}</div>
            <div className="muted small">{m.type}{m.location ? ` · ${m.location}` : ""}</div>
            <div className="meter"><span style={{ width: `${m.last_health ?? 0}%` }} /></div>
            <div className="row between small"><span className="muted">Health index</span><span>{m.last_health != null ? `${m.last_health} / 100` : "No reading"}</span></div>
            <div className="row between small"><span className="muted">{m.readings} reading(s)</span><span className="muted">{m.has_ideal ? "Ideal set" : "No ideal"}</span></div>
            <div className="row card-actions">
              {confirm === m.id ? (
                <>
                  <span className="small">Remove this machine and its history?</span>
                  <button className="btn danger" onClick={() => remove(m)}>Remove</button>
                  <button className="btn ghost" onClick={() => setConfirm(null)}>Keep</button>
                </>
              ) : <button className="btn ghost" onClick={() => setConfirm(m.id)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
