import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import useLoad from "../components/useLoad.js";

export default function Dashboard() {
  const { data: d, error, loading } = useLoad(api.dashboard);

  if (loading) return <div className="muted">Loading dashboard…</div>;
  if (error) return <div className="alert bad">{error}</div>;
  const t = d.totals;

  return (
    <>
      <header className="page-head">
        <div><h1>Dashboard</h1><p className="muted">Fleet status at a glance</p></div>
        <Link className="btn primary" to="/analyse">New analysis</Link>
      </header>

      <div className="stats">
        <div className="card"><div className="muted small">Machines</div><div className="stat">{t.machines}</div></div>
        <div className="card"><div className="muted small">Readings today</div><div className="stat">{t.today}</div></div>
        <div className="card"><div className="muted small">Need attention</div><div className="stat">{t.attention}</div></div>
        <div className="card"><div className="muted small">With an ideal set</div><div className="stat">{t.with_ideal}</div></div>
      </div>

      {d.alerts.length > 0 && (
        <div className="card">
          <h3>Needs attention</h3>
          {d.alerts.map((a) => (
            <div className="row between alert-row" key={a.machine_id}>
              <div><strong>{a.code}</strong> <span className="muted">{a.name}</span></div>
              <div className="row"><span className="small muted">Health {a.health ?? "–"}</span><Badge status={a.level} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Readings per day, last 14 days</h3>
        {t.readings === 0 ? <div className="muted">No readings saved yet. Analyse a recording and save it to start the history.</div> : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={d.activity}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} />
                <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} />
                <Tooltip />
                <Bar dataKey="readings" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Machines</h3>
        {d.fleet.length === 0 ? <div className="muted">No machines yet. <Link to="/machines">Add your first machine</Link>.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Machine</th><th>Location</th><th>Health</th><th>Status</th><th>Last reading</th></tr></thead>
              <tbody>
                {d.fleet.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.code}</strong><div className="muted small">{m.name}</div></td>
                    <td>{m.location || "–"}</td>
                    <td>{m.last_health != null ? `${m.last_health} / 100` : "–"}</td>
                    <td><Badge status={m.last_level} /></td>
                    <td className="muted">{m.last_reading || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {d.recent.length > 0 && (
        <div className="card">
          <h3>Recent readings</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Machine</th><th>File</th><th>Health</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.id}><td><strong>{r.code}</strong></td><td className="muted">{r.file_name}</td><td>{Math.round(r.health)} / 100</td><td><Badge status={r.level} /></td><td className="muted">{r.when}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
