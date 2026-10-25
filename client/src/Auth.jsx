import { useState } from "react";
import { supabase } from "./supabase.js";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUp, setSignUp] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const fn = signUp ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { data, error } = await fn.call(supabase.auth, { email, password });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (signUp && !data.session) setMsg("Account created. Check your email to confirm, then sign in.");
  };

  return (
    <main>
      <h1>My Daily Five</h1>
      <p className="sub">{signUp ? "Create your account" : "Sign in to see your progress"}</p>
      <form className="card auth" onSubmit={submit}>
        <input type="email" required placeholder="Email" aria-label="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password (6+ characters)" aria-label="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : signUp ? "Sign up" : "Sign in"}</button>
        {msg && <p className="msg">{msg}</p>}
        <button type="button" className="link" onClick={() => { setSignUp(!signUp); setMsg(""); }}>
          {signUp ? "I already have an account" : "New here? Create an account"}
        </button>
      </form>
    </main>
  );
}
