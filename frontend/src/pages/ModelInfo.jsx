import { modelApi } from "../api.js";
import useLoad from "../components/useLoad.js";

const f = (v, d = 3) => (v == null ? "–" : Number(v).toFixed(d));
const mids = ["id_00", "id_02", "id_04", "id_06"];

export default function ModelInfo() {
  const { data, error, loading } = useLoad(modelApi.get);
  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="alert bad">{error}</div>;
  if (!data.ready) return <div className="card muted">No trained model found. Run train.py first.</div>;

  const { info, machines, evaluation: ev } = data;
  const byId = ev?.by_id?.filter((r) => r.machine === "fan") || [];
  const snrs = [...new Set(byId.map((r) => r.snr))].sort((a, b) => b - a);
  const cell = (id, snr) => byId.find((r) => r.mid === id && r.snr === snr)?.auc;

  return (
    <>
      {/* <header className="page-head"><div><h1>Model info</h1><p className="muted">How the model was trained and how well it performs</p></div></header> */}

      <div className="stats">
        <div className="card"><div className="muted small">Trained</div><div className="stat small-stat">{info.trained_at}</div></div>
        <div className="card"><div className="muted small">Split</div><div className="stat small-stat">{info.split_mode} · {info.split_strategy}</div></div>
        <div className="card"><div className="muted small">Training noise levels (dB)</div><div className="stat small-stat">{(info.train_snrs || []).join(", ")}</div></div>
      </div>

      {Object.entries(machines).map(([name, m]) => (
        <div className="card" key={name}>
          <h3>{name} model</h3>
          <div className="stats">
            <div><div className="muted small">Decision threshold</div><strong>{f(m.threshold)}</strong></div>
            <div><div className="muted small">Segment pooling</div><strong>{m.pooling}</strong></div>
            <div><div className="muted small">Trained on machine IDs</div><strong>{m.train_ids.join(", ")}</strong></div>
            <div><div className="muted small">Calibration AUC / recall / specificity</div><strong>{f(m.calibration.auc)} / {f(m.calibration.recall)} / {f(m.calibration.specificity)}</strong></div>
          </div>
        </div>
      ))}

      {ev ? (
        <>
          <div className="card">
            <h3>Held-out test results (same machines, blocked split)</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Noise (dB)</th><th>Files</th><th>Accuracy</th><th>Recall</th><th>Specificity</th><th>Precision</th><th>F1</th><th>AUC</th></tr></thead>
                <tbody>
                  {ev.results.map((r) => (
                    <tr key={`${r.machine}${r.snr}`}>
                      <td><strong>{r.snr}</strong></td><td>{r.files}</td><td>{f(r.accuracy)}</td><td>{f(r.recall)}</td>
                      <td>{f(r.specificity)}</td><td>{f(r.precision)}</td><td>{f(r.f1)}</td><td>{f(r.auc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Split strategy: {ev.setup.strategy}. {ev.setup.independent ? "The test files were not used for training or tuning." : "These results are not independent, so do not report them."}</p>
          </div>

          {byId.length > 0 && (
            <div className="card">
              <h3>AUC by machine ID</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Machine ID</th>{snrs.map((s) => <th key={s}>{s} dB</th>)}</tr></thead>
                  <tbody>{mids.filter((id) => byId.some((r) => r.mid === id)).map((id) => <tr key={id}><td>{id}</td>{snrs.map((s) => <td key={s}>{f(cell(id, s))}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : <div className="card muted">No evaluation report yet. Run evaluate.py to see test results here.</div>}

      <div className="card">
        <h3>Limits to keep in mind</h3>
        <ul>
          <li>Test files come from the same machines and recording sessions as the training files. A new machine or a new day of recording could be harder.</li>
          <li>At the noisiest level (−6 dB) the model raises more false alarms. Check precision there, not only accuracy.</li>
          <li>The health index and maintenance levels are rules built on the model score. They are not validated predictions of when a machine will fail.</li>
        </ul>
      </div>
    </>
  );
}
