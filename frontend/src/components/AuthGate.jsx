import { useState } from "react";
import { LockKeyhole, Activity } from "lucide-react";
import { api } from "../lib/api";

export default function AuthGate({ status, onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const setup = !status.configured || resetting;

  async function submit(e) {
    e.preventDefault(); setError("");
    if (setup && password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    try { resetting ? await api.authReset(password) : setup ? await api.authSetup(password) : await api.authLogin(password); onAuthenticated(); }
    catch (err) { setError(String(err.message).replace(/^\d+:\s*/, "")); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center px-5">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl">
      <div className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-recovery/10 p-2.5 text-recovery">{setup ? <Activity size={22}/> : <LockKeyhole size={22}/>}</span><div><h1 className="font-display text-lg font-bold">{setup ? "Secure your Pulse" : "Unlock Pulse"}</h1><p className="text-xs text-muted">{setup ? "Create the single-owner password" : "Your health data is private"}</p></div></div>
      {setup && !status.setup_allowed ? <div className="rounded-xl border border-effort/30 bg-effort/10 p-4 text-sm text-txt">{resetting?"Password reset":"Initial setup"} must be completed on this PC at <strong>http://localhost:8080</strong>. Then use the same password on your phone.</div> : <>
        <label className="mb-1.5 block text-xs text-muted">Password</label><input aria-label="Password" autoFocus type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={10} required className="w-full rounded-xl bg-panel2 px-3 py-3 text-base outline-none focus:border-recovery" />
        {setup && <><label className="mb-1.5 mt-3 block text-xs text-muted">Confirm password</label><input aria-label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={10} required className="w-full rounded-xl bg-panel2 px-3 py-3 text-base outline-none focus:border-recovery" /></>}
        {error && <p className="mt-3 text-xs text-effort">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-xl bg-recovery px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50">{busy ? "Please wait…" : setup ? "Create password" : "Unlock"}</button>
        {setup && <p className="mt-3 text-center text-xs text-faint">At least 10 characters. Pulse never stores the plaintext password.</p>}
        {!setup && status.setup_allowed && <button type="button" onClick={()=>{setResetting(true);setPassword("");setConfirm("");setError("");}} className="mt-3 w-full text-center text-xs text-faint hover:text-txt">Forgot password? Reset securely on this PC</button>}
      </>}
    </form>
  </main>;
}
