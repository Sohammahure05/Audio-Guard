import { useState } from "react";
import { Link } from "react-router-dom";
import { api, batchApi } from "../api.js";
import Badge from "../components/Badge.jsx";
import useLoad from "../components/useLoad.js";

export default function Batch() {
  const { data: machines, error: loadError, loading } = useLoad(api.machines);
  const [files, setFiles] = useState([]);
  const [ids, setIds] = useState([]);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  if (loading) return <div className="muted">Loading…</div>;
  if (loadError) return <div className="alert bad">{loadError}</div>;
  if (!machines.length) return <div className="card muted">Add a machine first on the <Link to="/machines">Machines</Link> page.</div>;

  function pick(e) {
    const list = [...e.target.files].slice(0, 10);
    setFiles(list); setIds(list.map(() => ids[0] || machines[0].id)); setRows(null); setNote("");
  }
  const setAll = (id) => setIds(files.map(() => id));
  const setOne = (i, id) => setIds(ids.map((v, k) => (k === i ? id : v)));

  async function run(e) {
    e.preventDefault();
    setBusy(true); setError(""); setNote("");
    try { setRows((await batchApi.analyse(files, ids)).rows); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveAll() {
    try { setNote((await batchApi.saveAll(rows.filter((r) => r.analysis_id).map((r) => r.analysis_id))).message); }
    catch (err) { setNote(err.message); }
  }

  return (
    <>
      <header className="page-head"><div><h1>Batch analysis</h1><p className="muted">Check up to 10 recordings at once</p></div></header>

      <form className="card form-grid" onSubmit={run}>
        <label className="wide">Recordings
          <input type="file" multiple accept=".wav,.flac,.ogg,.mp3,.csv" onChange={pick} required />
        </label>
        {files.length > 0 && (
          <div className="wide">
            <div className="row between"><strong>Assign each file to a machine</strong>
              <label className="row small">Apply to all
                <select onChange={(e) => e.target.value && setAll(Number(e.target.value))} defaultValue="">
                  <option value="">Choose…</option>
                  {machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
                </select>
              </label>
            </div>
            {files.map((f, i) => (
              <div className="row between alert-row" key={f.name + i}>
                <span>{f.name}</span>
                <select value={ids[i]} onChange={(e) => setOne(i, Number(e.target.value))}>
                  {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        {error && <div className="alert bad wide" role="alert">{error}</div>}
        <div className="wide"><button className="btn primary" disabled={busy || !files.length}>{busy ? "Analysing…" : `Analyse ${files.length || ""} file(s)`}</button></div>
      </form>

      {rows && (
        <div className="card">
          <div className="row between">
            <h3>Results</h3>
            <button className="btn" onClick={saveAll} disabled={!rows.some((r) => r.analysis_id)}>Save all to history</button>
          </div>
          {note && <div className="small" role="status">{note}</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Machine</th><th>Verdict</th><th>Health</th><th>Sound drift vs ideal</th></tr></thead>
              <tbody>
                {rows.map((r, i) => r.error ? (
                  <tr key={i}><td>{r.file_name}</td><td>{r.machine_code}</td><td colSpan={3}><span className="alert bad">{r.error}</span></td></tr>
                ) : (
                  <tr key={i}>
                    <td>{r.file_name}</td><td><strong>{r.machine_code}</strong></td>
                    <td>{r.status} <Badge status={r.level} /></td>
                    <td>{Math.round(r.health)} / 100</td>
                    <td className="muted">{r.degradation_pct != null ? `${r.degradation_pct.toFixed(1)}% · ${r.condition}` : "No ideal"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
