import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import Auth from "./Auth.jsx";

const BASE = [
  { id: "book", name: "Read today’s law", sub: "The Diary of a CEO · 32 laws", ph: "In one line: how will I use it today?" },
  { id: "bible", name: "Read a Bible verse", sub: "Keep the streak going", ph: "The verse and what it told me" },
  { id: "comm", name: "Practise communication", sub: "Listen, speak clearly, ask good questions", ph: "What did I practise today?" },
  { id: "conf", name: "Build confidence", sub: "One small brave action", ph: "The brave thing I did" },
  { id: "money", name: "Money idea", sub: "Money is a tool. Find one way to earn.", ph: "One way I could earn or add value" },
];

const KEY = "dailyFive.v1";
const pad = (n) => (n < 10 ? "0" : "") + n;
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

function load() {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const d = JSON.parse(s);
      return { days: d.days || {}, custom: d.custom || [] };
    }
  } catch (e) {}
  return { days: {}, custom: [] };
}

// Compare data without caring about key order
const stable = (o) =>
  JSON.stringify(o, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );

// Merge cloud data and this device's data. The newest change wins.
function pick(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = a.t || 0, tb = b.t || 0;
  if (ta !== tb) return ta > tb ? a : b;
  return { ...a, ...b, done: !!(a.done || b.done), note: b.note || a.note || "" };
}

function merge(cloud, local) {
  const days = { ...cloud.days };
  for (const k in local.days) {
    days[k] = { ...(days[k] || {}) };
    for (const h in local.days[k]) {
      days[k][h] = pick(days[k][h], local.days[k][h]);
    }
  }
  const ids = new Set(cloud.custom.map((c) => c.id));
  const custom = [...cloud.custom, ...local.custom.filter((c) => !ids.has(c.id))];
  return { days, custom };
}

function Tracker({ userId }) {
  const [data, setData] = useState(load);
  const [cur, setCur] = useState(new Date());
  const [newHabit, setNewHabit] = useState("");
  const [pending, setPending] = useState(null);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState("Connecting to cloud…");
  const today = fmt(new Date());
  const key = fmt(cur);
  const isToday = key === today;

  // 1) Load from the cloud, then keep listening for changes from other devices
  useEffect(() => {
    let live = true;

    const apply = (cloud) =>
      setData((local) => {
        const m = merge(cloud, local);
        return stable(m) === stable(local) ? local : m; // no change = no re-save
      });

    const pull = async () => {
      const { data: row, error } = await supabase
        .from("tracker")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (!live) return;
      if (error) {
        setStatus("Could not load: " + error.message);
        return; // do not enable saving, so cloud data is never overwritten
      }
      if (row?.data?.days) apply({ days: row.data.days || {}, custom: row.data.custom || [] });
      setSynced((was) => {
        if (!was) setStatus("Connected to cloud ✓");
        return true;
      });
    };

    pull();

    // Live updates pushed from the cloud
    const channel = supabase
      .channel("tracker-" + userId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracker", filter: `user_id=eq.${userId}` },
        (payload) => {
          const d = payload.new?.data;
          if (d?.days) apply({ days: d.days || {}, custom: d.custom || [] });
        }
      )
      .subscribe();

    // Catch up when you come back to the app
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // 2) On every change: keep a local copy and save to the cloud
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {}
    if (!synced) return;
    setStatus("Saving…");
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from("tracker")
        .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
      setStatus(error ? "Not saved: " + error.message : "Saved to cloud ✓");
    }, 800);
    return () => clearTimeout(t);
  }, [data, synced, userId]);

  const habits = useMemo(
    () =>
      BASE.concat(
        data.custom.map((c) => ({
          id: c.id,
          name: c.name,
          sub: "My own habit",
          ph: "Notes or how it went",
          custom: true,
        }))
      ),
    [data.custom]
  );

  const entry = (k, h) => data.days[k]?.[h] || {};

  const update = (h, patch) =>
    setData((d) => ({
      ...d,
      days: {
        ...d.days,
        [key]: { ...d.days[key], [h]: { ...d.days[key]?.[h], ...patch, t: Date.now() } },
      },
    }));

  const streak = (h) => {
    let d = new Date();
    let n = 0;
    if (!entry(fmt(d), h).done) d = shift(d, -1);
    while (entry(fmt(d), h).done) {
      n++;
      d = shift(d, -1);
    }
    return n;
  };

  const totalDone = (h) =>
    Object.values(data.days).filter((day) => day[h]?.done).length;

  const done = habits.filter((h) => entry(key, h.id).done).length;
  const N = habits.length;
  const msg =
    done === N ? "All done today. Well done." : done === 0 ? "Start with one. Small wins add up." : `${N - done} to go`;

  const addHabit = () => {
    const v = newHabit.trim();
    if (!v) return;
    setData((d) => ({ ...d, custom: [...d.custom, { id: "c" + Date.now(), name: v.slice(0, 40) }] }));
    setNewHabit("");
  };

  const removeHabit = (id) => {
    if (pending !== id) {
      setPending(id);
      setTimeout(() => setPending((p) => (p === id ? null : p)), 3000);
      return;
    }
    setPending(null);
    setData((d) => ({ ...d, custom: d.custom.filter((c) => c.id !== id) }));
  };

  const isError = status.startsWith("Not saved") || status.startsWith("Could not");

  return (
    <main>
      <div className="top">
        <h1>My Daily Five</h1>
        <div className="nav">
          <button aria-label="Previous day" onClick={() => setCur(shift(cur, -1))}>‹</button>
          <div className="date">
            {isToday ? "Today" : cur.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </div>
          <button aria-label="Next day" disabled={isToday} onClick={() => setCur(shift(cur, 1))}>›</button>
        </div>
      </div>

      <div className="summary">
        <b>{done} of {N}</b> · {msg}
        <div className="bar"><i style={{ width: `${(done / N) * 100}%` }} /></div>
      </div>

      <WeekSummary habits={habits} entry={entry} data={data} today={today} />

      {habits.map((h) => {
        const e = entry(key, h.id);
        const t = Math.min(32, totalDone("book"));
        return (
          <section key={h.id} className={"card" + (e.done ? " done" : "")}>
            <div className="row">
              <button
                className="check"
                aria-pressed={!!e.done}
                aria-label={`Mark ${h.name} done`}
                onClick={() => update(h.id, { done: !e.done })}
              >
                {e.done ? "✓" : ""}
              </button>
              <div className="info">
                <div className="name">
                  {h.name}
                  {h.custom && (
                    <button className="link rm" onClick={() => removeHabit(h.id)}>
                      {pending === h.id ? "tap again to confirm" : "remove"}
                    </button>
                  )}
                </div>
                <div className="sub">{h.sub}</div>
                {h.id === "book" && (
                  <>
                    <div className="laws">
                      {t >= 32 ? "All 32 laws read" : `Laws read: ${t} of 32 · next is Law ${t + 1}`}
                    </div>
                    <div className="lawbar"><i style={{ width: `${(t / 32) * 100}%` }} /></div>
                  </>
                )}
                <div className="meta">
                  <span className="streak">🔥 {streak(h.id)}-day streak</span>
                  <span className="dots" title="Last 7 days">
                    {[6, 5, 4, 3, 2, 1, 0].map((i) => (
                      <span key={i} className={entry(fmt(shift(cur, -i)), h.id).done ? "on" : ""} />
                    ))}
                  </span>
                </div>
              </div>
            </div>
            <textarea
              rows={2}
              placeholder={h.ph}
              aria-label={`${h.name} note`}
              value={e.note || ""}
              onChange={(ev) => update(h.id, { note: ev.target.value })}
            />
          </section>
        );
      })}

      <div className="addbox">
        <input
          maxLength={40}
          placeholder="Something new to improve…"
          aria-label="New habit name"
          value={newHabit}
          onChange={(e) => setNewHabit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addHabit()}
        />
        <button aria-label="Add habit" onClick={addHabit}>+</button>
      </div>

      <p className="signout">
        <span style={{ color: isError ? "#d64545" : undefined }}>{status}</span>
        <br />
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </p>
    </main>
  );
}

function WeekSummary({ habits, entry, data, today }) {
  let first = null;
  for (const k in data.days) {
    for (const h in data.days[k]) {
      if (data.days[k][h]?.done && (!first || k < first)) first = k;
    }
  }
  if (!first) return null;

  const span = Math.floor((new Date(today + "T00:00:00") - new Date(first + "T00:00:00")) / 864e5) + 1;
  if (span < 7) {
    const left = 7 - span;
    return (
      <div className="wk teaser">
        Your weekly summary appears in {left} day{left === 1 ? "" : "s"}. Keep going.
      </div>
    );
  }

  let total = 0, best = null, low = null;
  const rows = habits.map((h) => {
    let n = 0;
    for (let i = 0; i < 7; i++) if (entry(fmt(shift(new Date(), -i)), h.id).done) n++;
    total += n;
    if (!best || n > best.n) best = { n, name: h.name };
    if (!low || n < low.n) low = { n, name: h.name };
    return { id: h.id, name: h.name, n };
  });
  const pct = Math.round((total / (habits.length * 7)) * 100);

  return (
    <div className="wk">
      <div className="name">Your week</div>
      <div className="sub">Last 7 days, updated automatically</div>
      <div className="big">{pct}%</div>
      {rows.map((r) => (
        <div key={r.id}>
          <div className="wrow"><span>{r.name}</span><b>{r.n}/7</b></div>
          <div className="lawbar"><i style={{ width: `${(r.n / 7) * 100}%` }} /></div>
        </div>
      ))}
      <p>
        Strongest: <b>{best.name}</b> ({best.n}/7). Focus next: <b>{low.name}</b> ({low.n}/7).
      </p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main><p>Loading…</p></main>;
  if (!session) return <Auth />;
  return <Tracker userId={session.user.id} />;
}
