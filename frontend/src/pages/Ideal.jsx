import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, idealApi } from "../api.js";
import useLoad from "../components/useLoad.js";

export default function Ideal() {
  const { data: machines, error: loadError, loading } = useLoad(api.machines);
  const [machineId, setMachineId] = useState("");
  const [state, setState] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(false);

  async function refresh(id) {
    setState(null); setResult(null); setError(""); setConfirm(false);
    if (!id) return;
    try { setState(await idealApi.get(id)); } catch (err) { setError(err.message); }
  }
  useEffect(() => { refresh(machineId); }, [machineId]);

  async function build(e) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await idealApi.build(machineId, files));
      setFiles([]); e.target.reset();
      setState(await idealApi.get(machineId));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove() {
    try { await idealApi.remove(machineId); refresh(machineId); } catch (err) { setError(err.message); }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (loadError) return <div className="alert bad">{loadError}</div>;
  if (!machines.length) return <div className="card muted">Add a machine first on the <Link to="/machines">Machines</Link> page.</div>;

  const min = state?.minimum_clips ?? 3;
  const ideal = state?.ideal;
  const profile = ideal ? state.profile_axis.map((hz, i) => ({ hz, level: ideal.profile[i] })) : [];

  return (
    <>
      <header className="page-head"><div><h1>Ideal sound</h1><p className="muted">Record what a healthy machine sounds like, then compare later readings against it</p></div></header>

      <div className="card">
        <label>Machine
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Select a machine</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="alert bad" role="alert">{error}</div>}

      {ideal && (
        <div className="card">
          <div className="row between">
            <h3>Current ideal</h3>
            {confirm ? (
              <div className="row"><span className="small">Remove this ideal?</span><button className="btn danger" onClick={remove}>Remove</button><button className="btn ghost" onClick={() => setConfirm(false)}>Keep</button></div>
            ) : <button className="btn ghost" onClick={() => setConfirm(true)}>Remove ideal</button>}
          </div>
          <p className="muted small">Built from {ideal.clips} healthy clip(s) on {ideal.created}. Average health {Math.round(ideal.health)} / 100.</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={profile}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="hz" stroke="var(--muted)" fontSize={12} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
                <YAxis stroke="var(--muted)" fontSize={12} />
                <Tooltip formatter={(v) => v.toFixed(1)} labelFormatter={(v) => `${v} Hz`} />
                <Line dataKey="level" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Average sound level across pitch for the healthy machine.</p>
        </div>
      )}

      {machineId && state && (
        <form className="card form-grid" onSubmit={build}>
          <h3 className="wide">{ideal ? "Replace the ideal" : "Build the ideal"}</h3>
          <p className="muted small wide">Upload {min} to 10 recordings made while the machine was known to be healthy. Clips that the model classes as abnormal are rejected.</p>
          <label className="wide">Healthy recordings
            <input type="file" multiple accept=".wav,.flac,.ogg,.mp3,.csv" onChange={(e) => setFiles([...e.target.files])} required />
          </label>
          <div className="wide row">
            <button className="btn primary" disabled={busy || files.length < min || files.length > 10}>{busy ? "Building…" : "Build ideal"}</button>
            <span className="small muted">{files.length} file(s) selected{files.length > 0 && files.length < min ? ` · need at least ${min}` : ""}</span>
          </div>
        </form>
      )}

      {result && (
        <div className="alert ok" role="status">
          {result.message} Used {result.clips} clips. Clip health: {result.clip_health.map((c) => `${c.file_name} ${Math.round(c.health)}`).join(", ")}.
        </div>
      )}
    </>
  );
}
