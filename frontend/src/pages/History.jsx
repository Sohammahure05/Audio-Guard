import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, historyApi } from "../api.js";
import Badge from "../components/Badge.jsx";
import useLoad from "../components/useLoad.js";

function Trend({ title, data, keyName, domain, note }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div style={{ height: 200 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="n" allowDecimals={false} stroke="var(--muted)" fontSize={12} />
            <YAxis domain={domain} stroke="var(--muted)" fontSize={12} />
            <Tooltip labelFormatter={(n, p) => p?.[0]?.payload?.when || `Reading ${n}`} formatter={(v) => (v == null ? "–" : v.toFixed(1))} />
            <Line dataKey={keyName} stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted">{note}</p>
    </div>
  );
}

export default function History() {
  const { data: machines, error: loadError, loading } = useLoad(api.machines);
  const [machineId, setMachineId] = useState("");
  const [since, setSince] = useState(true);
  const [h, setH] = useState(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);

  async function load() {
    if (!machineId) { setH(null); return; }
    setError("");
    try { setH(await historyApi.get(machineId, since)); } catch (err) { setError(err.message); }
  }
  useEffect(() => { setConfirm(null); load(); }, [machineId, since]);

  async function remove(id) {
    try { await historyApi.remove(id); setConfirm(null); load(); } catch (err) { setError(err.message); }
  }
  const run = (fn) => async () => { try { await fn(); } catch (err) { setError(err.message); } };

  if (loading) return <div className="muted">Loading…</div>;
  if (loadError) return <div className="alert bad">{loadError}</div>;
  if (!machines.length) return <div className="card muted">Add a machine first on the <Link to="/machines">Machines</Link> page.</div>;

  return (
    <>
      <header className="page-head">
        <div><h1>History</h1><p className="muted">Saved readings for each machine</p></div>
        {h && <button className="btn" onClick={run(() => historyApi.csv(machineId))}>Export CSV</button>}
      </header>

      <div className="card form-grid">
        <label>Machine
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Select a machine</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={since} onChange={(e) => setSince(e.target.checked)} />Only readings since the ideal was set</label>
      </div>

      {error && <div className="alert bad" role="alert">{error}</div>}

      {h && (
        <>
          {h.older_readings > 0 && <div className="alert warn">{h.older_readings} reading(s) were made with an older model and are left out of the charts, because their health values cannot be compared.</div>}

          <div className="stats">
            <div className="card"><div className="muted small">Readings saved</div><div className="stat">{h.rows.length}</div></div>
            <div className="card"><div className="muted small">Health trend</div><div className="stat small-stat">{h.trend.points < 5 ? "Not enough readings" : h.trend.direction}</div></div>
            <div className="card"><div className="muted small">Ideal</div><div className="stat small-stat">{h.ideal ? `Set (${Math.round(h.ideal.health)})` : "Not set"}</div></div>
          </div>

          {h.chart.length === 0 ? (
            <div className="card muted">No readings to chart yet. Analyse a recording for this machine and choose “Save to history”.</div>
          ) : (
            <div className="two">
              <Trend title="Health index" data={h.chart} keyName="health" domain={[0, 100]} note="Higher is healthier. 50 is the decision boundary." />
              {h.ideal
                ? <Trend title="Sound drift from ideal" data={h.chart} keyName="degradation" domain={[0, "auto"]} note="Percent of change in sound shape from the ideal. Lower is closer. A sudden jump can mean a different machine or recording setup, not only a fault." />
                : <div className="card"><h3>Sound drift from ideal</h3><p className="muted">Set an ideal on the <Link to="/ideal">Ideal</Link> page to see this chart.</p></div>}
            </div>
          )}

          <div className="card">
            <h3>All readings</h3>
            {h.rows.length === 0 ? <div className="muted">Nothing saved yet.</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>File</th><th>Health</th><th>Status</th><th>Model</th><th></th></tr></thead>
                  <tbody>
                    {[...h.rows].reverse().map((r) => (
                      <tr key={r.id}>
                        <td className="muted">{r.recorded_at}</td>
                        <td>{r.file_name}</td>
                        <td>{Math.round(r.health)} / 100</td>
                        <td><Badge status={r.level} /></td>
                        <td className="muted small">{r.current_model ? "Current" : "Older"}</td>
                        <td>
                          <div className="row">
                            {r.has_recording && <button className="btn ghost" onClick={run(() => historyApi.pdf(r.id))}>PDF</button>}
                            {confirm === r.id ? (
                              <><button className="btn danger" onClick={() => remove(r.id)}>Delete</button><button className="btn ghost" onClick={() => setConfirm(null)}>Keep</button></>
                            ) : <button className="btn ghost" onClick={() => setConfirm(r.id)}>Delete</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
