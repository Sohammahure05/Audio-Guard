const tone = { Healthy: "ok", Watch: "warn", "Maintenance required": "bad", Critical: "bad" };

export default function Badge({ status }) {
  if (!status) return <span className="badge none">No reading</span>;
  return <span className={`badge ${tone[status] || "ok"}`}>{status}</span>;
}
