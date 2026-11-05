const KEY = "mh-auth";

function token() {
  try { return JSON.parse(sessionStorage.getItem(KEY))?.token; } catch { return null; }
}

async function raw(path, options = {}) {
  const headers = { ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the server. Is the API running on port 8000?");
  }
  if (res.status === 401 && token()) {
    sessionStorage.removeItem(KEY);
    window.dispatchEvent(new Event("mh-signout"));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join(", ") : body.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res;
}

const request = async (path, options) => (await raw(path, options)).json();

const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const api = {
  login: (username, password) => request("/auth/login", json("POST", { username, password })),
  register: (username, password, company) => request("/auth/register", json("POST", { username, password, company })),
  dashboard: () => request("/dashboard"),
  machines: () => request("/machines"),
  addMachine: (m) => request("/machines", json("POST", m)),
  deleteMachine: (id) => request(`/machines/${id}`, { method: "DELETE" }),
};

export const analyseApi = {
  analyse(machineId, file, rate) {
    const body = new FormData();
    body.append("file", file);
    body.append("csv_rate", String(rate));
    return request(`/machines/${machineId}/analyse`, { method: "POST", body });
  },
  save: (key) => request(`/analyses/${key}/save`, { method: "POST" }),
  async pdf(key) {
    const res = await raw(`/analyses/${key}/report.pdf`);
    const cd = res.headers.get("Content-Disposition") || "";
    const name = (cd.match(/filename="(.+?)"/) || [])[1] || "report.pdf";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const idealApi = {
  get: (id) => request(`/machines/${id}/ideal`),
  build(id, files) {
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    return request(`/machines/${id}/ideal`, { method: "POST", body });
  },
  remove: (id) => request(`/machines/${id}/ideal`, { method: "DELETE" }),
};

async function download(path) {
  const res = await raw(path);
  const cd = res.headers.get("Content-Disposition") || "";
  const name = (cd.match(/filename="(.+?)"/) || [])[1] || "download";
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export const historyApi = {
  get: (id, sinceIdeal) => request(`/machines/${id}/history?since_ideal=${sinceIdeal}`),
  csv: (id) => download(`/machines/${id}/history.csv`),
  pdf: (readingId) => download(`/readings/${readingId}/report.pdf`),
  remove: (readingId) => request(`/readings/${readingId}`, { method: "DELETE" }),
};

export const batchApi = {
  analyse(files, machineIds) {
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    machineIds.forEach((id) => body.append("machine_ids", String(id)));
    return request("/batch/analyse", { method: "POST", body });
  },
  saveAll: (ids) => request("/analyses/save", json("POST", { ids })),
};

export const readingsApi = { all: () => request("/readings") };
export const modelApi = { get: () => request("/model") };
