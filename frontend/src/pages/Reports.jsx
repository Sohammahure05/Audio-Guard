import { useState } from "react";
import { historyApi, readingsApi } from "../api.js";
import Badge from "../components/Badge.jsx";
import useLoad from "../components/useLoad.js";

export default function Reports() {
  const { data, error, loading } = useLoad(readingsApi.all);
  const [machine, setMachine] = useState("all");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState("");

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="alert bad">{error}</div>;

  const codes = [...new Set(data.map((r) => r.code))];
  const rows = data.filter((r) => (machine === "all" || r.code === machine) && r.file_name.toLowerCase().includes(query.toLowerCase()));

  async function pdf(id) {
    setErr("");
    try { await historyApi.pdf(id); } catch (e) { setErr(e.message); }
  }

  return (
    <>
      <header className="page-head"><div><h1>Reports</h1><p className="muted">Download a PDF report for any saved reading</p></div></header>
      <div className="card form-grid">
        <label>Machine
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="all">All machines</option>
            {codes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Search by file name<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      </div>
      {err && <div className="alert bad" role="alert">{err}</div>}
      <div className="card">
        {rows.length === 0 ? <div className="muted">{data.length ? "No readings match." : "No saved readings yet. Analyse a recording and save it to history."}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Machine</th><th>File</th><th>Health</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{r.when}</td><td><strong>{r.code}</strong></td><td>{r.file_name}</td>
                    <td>{Math.round(r.health)} / 100</td><td><Badge status={r.level} /></td>
                    <td><button className="btn ghost" onClick={() => pdf(r.id)}>Download PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">A report can only be rebuilt if the original recording was stored when the reading was saved.</p>
      </div>
    </>
  );
}
