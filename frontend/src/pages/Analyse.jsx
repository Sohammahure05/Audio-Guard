import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { analyseApi, api, historyApi } from "../api.js";
import Badge from "../components/Badge.jsx";
import Spectrogram from "../components/Spectrogram.jsx";
import useLoad from "../components/useLoad.js";

const text = (v) => (typeof v === "string" ? v : v?.message || v?.text || JSON.stringify(v));
const pct = (v) => (v == null ? "–" : `${v.toFixed(1)}%`);

export default function Analyse() {
  const { data: machines, error: loadError, loading } = useLoad(api.machines);
  const [machineId, setMachineId] = useState("");
  const [file, setFile] = useState(null);
  const [rate, setRate] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [out, setOut] = useState(null);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState("");
  const input = useRef(null);

  const isCsv = file?.name.toLowerCase().endsWith(".csv");

  async function run(e) {
    e.preventDefault();
    setBusy(true); setError(""); setOut(null); setSaved(false); setNote("");
    try { setOut(await analyseApi.analyse(machineId, file, rate)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function save() {
    try { setNote((await analyseApi.save(out.analysis_id)).message); setSaved(true); }
    catch (err) { setNote(err.message); }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (loadError) return <div className="alert bad">{loadError}</div>;
  if (!machines.length) return <div className="card muted">Add a machine first on the <Link to="/machines">Machines</Link> page.</div>;

  return (
    <>
      <header className="page-head"><div><h1>Analyse</h1><p className="muted">Upload a recording to check a machine’s condition</p></div></header>

      <form className="card form-grid" onSubmit={run}>
        <label>Machine
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} required>
            <option value="">Select a machine</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.type})</option>)}
          </select>
        </label>
        <label>Recording
          <input ref={input} type="file" accept=".wav,.flac,.ogg,.mp3,.csv" onChange={(e) => setFile(e.target.files[0] || null)} required />
        </label>
        {isCsv && <label>CSV sampling rate (Hz)<input type="number" min="1000" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>}
        {error && <div className="alert bad wide" role="alert">{error}</div>}
        <div className="wide"><button className="btn primary" disabled={busy || !file || !machineId}>{busy ? "Analysing…" : "Analyse recording"}</button></div>
      </form>

      {out && <Result out={out} saved={saved} note={note} onSave={save} />}
    </>
  );
}

function Result({ out, saved, note, onSave }) {
  const r = out.result;
  const tone = r.level === "Healthy" ? "ok" : r.level === "Watch" ? "warn" : "bad";
  const wave = out.waveform.map(([t, lo, hi]) => ({ t, range: [lo, hi] }));
  const d = out.degradation;
  const notes = [...(out.alerts || []), ...(d?.alerts || [])];
  const [busyPdf, setBusyPdf] = useState(false);

  return (
    <>
      <div className={`card verdict ${tone}`}>
        <div className="row between">
          <div><div className="small muted">{out.machine.code} · {out.file_name}</div><h2>{r.status}: <Badge status={r.level} /></h2></div>
          <div className="row">
            <button className="btn" onClick={onSave} disabled={saved}>{saved ? "Saved" : "Save to history"}</button>
            <button className="btn" disabled={busyPdf} onClick={async () => { setBusyPdf(true); try { await analyseApi.pdf(out.analysis_id); } finally { setBusyPdf(false); } }}>
              {busyPdf ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </div>
        <p>{r.advice}</p>
        {note && <div className="small" role="status">{note}</div>}
      </div>

      <div className="stats">
        <div className="card"><div className="muted small">Health index</div><div className="stat">{Math.round(r.health)}<span className="small muted"> / 100</span></div></div>
        <div className="card"><div className="muted small">Score vs threshold</div><div className="stat">{r.score.toFixed(2)}<span className="small muted"> / {r.threshold.toFixed(2)}</span></div></div>
        <div className="card"><div className="muted small">Segments flagged</div><div className="stat">{r.flagged}<span className="small muted"> / {r.segments}</span></div></div>
        <div className="card"><div className="muted small">Decision confidence</div><div className="stat">{Math.round(r.confidence * 100)}<span className="small muted">%</span></div></div>
      </div>

      <div className="card">
        <h3>Abnormality timeline</h3>
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={r.segments_detail.map((s) => ({ ...s, label: `${s.start}–${s.end}s` }))}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" padding={{ left: 12, right: 12 }} stroke="var(--muted)" fontSize={12} />
              <YAxis domain={[0, 1]} stroke="var(--muted)" fontSize={12} />
              <Tooltip formatter={(v) => v.toFixed(3)} />
              <ReferenceLine y={r.threshold} stroke="var(--bad)" strokeDasharray="5 4" />
              <Bar dataKey="score" radius={[4, 4, 0, 0]} minPointSize={3}>
                {r.segments_detail.map((s, i) => <Cell key={i} fill={s.flagged ? "var(--bad)" : "var(--ok)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="small muted">Dashed line = decision threshold ({r.threshold.toFixed(2)}). Peak score {r.peak_score.toFixed(2)} at {r.peak_time}s. Longest abnormal stretch: {r.longest_run}s.</p>
      </div>

      <div className="two">
        <div className="card">
          <h3>Waveform</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <AreaChart data={wave}>
                <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} allowDecimals={false} stroke="var(--muted)" fontSize={12} tickFormatter={(v) => `${v}s`} />
                <YAxis stroke="var(--muted)" fontSize={12} />
                <Area dataKey="range" stroke="var(--accent)" fill="var(--accent-soft)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card"><h3>Spectrogram</h3><Spectrogram data={out.spectrogram} /></div>
      </div>

      <TrendCharts out={out} saved={saved} />

      {d ? (
        <div className="card">
          <h3>Sound drift from this machine’s ideal</h3>
          <div className="stats">
            <div><div className="muted small">Condition</div><strong>{d.condition}</strong></div>
            <div><div className="muted small">Sound drift (R²)</div><strong>{pct(d.r2_pct)}</strong></div>
            <div><div className="muted small">Trend</div><strong>{d.series_trend?.direction}</strong></div>
          </div>
          <p className="small muted">This compares the shape of the sound with the ideal. It can differ from the fault verdict above, for example when the recording comes from a different machine, microphone or noise level.</p>
        </div>
      ) : (
        <div className="card muted">No ideal is set for this machine yet, so there is nothing to compare against. Set one on the Ideal page.</div>
      )}

      {(notes.length > 0 || out.comparison?.changes?.length > 0) && (
        <div className="card">
          <h3>Alerts and changes</h3>
          <ul>{notes.map((n, i) => <li key={`a${i}`}>{text(n)}</li>)}{(out.comparison?.changes || []).map((c, i) => <li key={`c${i}`}>{text(c)}</li>)}</ul>
        </div>
      )}

    </>
  );
}

function TrendCharts({ out, saved }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    historyApi.get(out.machine.id, true).then((x) => alive && setH(x)).catch(() => alive && setH({ chart: [] }));
    return () => { alive = false; };
  }, [out.analysis_id, saved]);

  if (!h) return null;
  const r = out.result;
  const d = out.degradation;
  const past = saved ? h.chart.slice(0, -1) : h.chart;
  const n = past.length + 1;

  const health = [...past.map((p) => ({ n: p.n, saved: p.health })), { n, current: r.health }];
  if (past.length) {
    health[past.length - 1].bridge = past[past.length - 1].health;
    health[past.length].bridge = r.health;
  }

  const reference = out.ideal ? out.ideal.profile : out.comparison?.baseline_profile;
  const profile = reference ? out.profile_axis.map((hz, i) => ({ hz, reference: reference[i], reading: r.profile[i] })) : null;

  const watch = d?.watch_pct ?? 8;
  const degraded = d?.degraded_pct ?? 12;
  const drift = d ? [{ n: 0, label: "ideal", saved: 0 }, ...past.map((p) => ({ n: p.n, label: String(p.n), saved: p.degradation })), { n, label: String(n), current: d.r2_pct }] : null;
  if (drift) {
    drift[drift.length - 2].bridge = drift[drift.length - 2].saved;
    drift[drift.length - 1].bridge = d.r2_pct;
  }

  return (
    <>
      <div className="two">
        <div className="card">
          <h3>Health index over time</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={health}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="n" allowDecimals={false} padding={{ left: 12, right: 12 }} stroke="var(--muted)" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="var(--muted)" fontSize={12} />
                <Tooltip formatter={(v) => v.toFixed(0)} />
                <ReferenceLine y={50} stroke="var(--muted)" strokeDasharray="5 4" />
                <Legend />
                <Line dataKey="bridge" stroke="var(--accent)" strokeDasharray="3 4" strokeWidth={2} dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls isAnimationActive={false} />
                <Line name="saved readings" dataKey="saved" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} isAnimationActive={false} />
                <Line name="this reading" dataKey="current" stroke="var(--bad)" dot={{ r: 5, fill: "var(--bad)" }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Dashed line: 50 is the decision boundary.{past.length === 0 ? " No earlier readings are saved for this machine yet." : ""}</p>
        </div>

        {drift ? (
          <div className="card">
            <h3>Sound drift from ideal</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={drift}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" padding={{ left: 12, right: 12 }} stroke="var(--muted)" fontSize={12} />
                  <YAxis domain={[0, (max) => Math.max(40, Math.ceil(max / 10) * 10 + 10)]} stroke="var(--muted)" fontSize={12} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <ReferenceLine y={watch} stroke="var(--warn)" strokeDasharray="5 4" />
                  <ReferenceLine y={degraded} stroke="var(--bad)" strokeDasharray="5 4" />
                  <Legend />
                  <Line dataKey="bridge" stroke="var(--accent)" strokeDasharray="3 4" strokeWidth={2} dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls isAnimationActive={false} />
                <Line name="saved readings" dataKey="saved" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} connectNulls isAnimationActive={false} />
                  <Line name="this reading" dataKey="current" stroke="var(--bad)" dot={{ r: 5, fill: "var(--bad)" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted">Orange line: drifting limit ({watch.toFixed(0)}%). Red line: far-from-ideal limit ({degraded.toFixed(0)}%).{d.natural_spread != null ? ` Limits are set from how much this machine’s own ideal clips vary (${d.natural_spread.toFixed(0)}%).` : ""}</p>
          </div>
        ) : (
          <div className="card"><h3>Sound drift from ideal</h3><p className="muted">Set an ideal for this machine to see this chart.</p></div>
        )}
      </div>

      {profile && (
        <div className="card">
          <h3>Spectral profile: this reading vs {out.ideal ? "machine ideal" : "earlier readings"}</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={profile}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="hz" stroke="var(--muted)" fontSize={12} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} interval={4} />
                <YAxis stroke="var(--muted)" fontSize={12} />
                <Tooltip formatter={(v) => v.toFixed(1)} labelFormatter={(v) => `${v} Hz`} />
                <Legend />
                <Line name={out.ideal ? "machine ideal" : "average of earlier readings"} dataKey="reference" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line name="this reading" dataKey="reading" stroke="var(--bad)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Sound level (dB, normalised) across pitch. Bigger gaps between the lines mean a bigger change in sound character.</p>
        </div>
      )}
    </>
  );
}
