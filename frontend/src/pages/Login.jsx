import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { auth, signIn } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "", company: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  if (auth) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "register") {
        await api.register(form.username, form.password, form.company);
        setMode("login"); setNotice("Account created. Sign in to continue.");
      } else {
        signIn(await api.login(form.username, form.password));
        navigate("/");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const register = mode === "register";
  return (
    <div className="login">
      <section className="login-hero">
        <div className="brand"><span className="brand-mark" /><span>Machine Health</span></div>
        <h1>Hear problems before they stop production.</h1>
        <p>Upload a machine recording, get a health verdict, and track every machine over time.</p>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>{register ? "Create account" : "Sign in"}</h2>
          <label>Username<input value={form.username} onChange={set("username")} autoComplete="username" required /></label>
          {register && <label>Company<input value={form.company} onChange={set("company")} required /></label>}
          <label>Password<input type="password" value={form.password} onChange={set("password")} autoComplete={register ? "new-password" : "current-password"} required /></label>
          {register && <p className="muted small">At least 8 characters, with a letter and a digit.</p>}
          {notice && <div className="alert ok" role="status">{notice}</div>}
          {error && <div className="alert bad" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
          <button type="button" className="link" onClick={() => { setMode(register ? "login" : "register"); setError(""); setNotice(""); }}>
            {register ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </form>
      </section>
    </div>
  );
}
