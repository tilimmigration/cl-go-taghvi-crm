import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import Login from "./views/Login.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Pipeline from "./views/Pipeline.jsx";
import PostCE from "./views/PostCE.jsx";
import LeadRecord from "./views/LeadRecord.jsx";
import FunnelMap from "./views/FunnelMap.jsx";
import Roadmap from "./views/Roadmap.jsx";
import { VIEWS } from "./data.js";
import { supabase } from "./lib/supabaseClient.js";

const PROPS = {
  clientName: "Taghavi Immigration Law",
  showAiPanel: true,
  showDedupeFlags: true,
  showBenchmarkTargets: true,
};

export default function App() {
  // undefined = still checking for an existing session; null = signed out.
  // The session is owned by Supabase Auth (persisted in localStorage by
  // supabase-js and refreshed automatically). The old sessionStorage flag
  // that gated the UI without any real authentication is gone.
  const [session, setSession] = useState(undefined);
  const [view, setView] = useState("dash");
  // Dashboard date filter: inclusive "YYYY-MM-DD" bounds on when a record
  // was created on Monday. Empty string means "no bound on that side", so
  // both empty = all time (the default).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [aiTab, setAiTab] = useState("summary");
  const [leadKey, setLeadKey] = useState("ana");

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const v = VIEWS[view];

  function openLead(key) {
    setLeadKey(key);
    setView("record");
  }

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setView("dash");
  }

  if (session === undefined) {
    return <div style={{ minHeight: "100vh", background: "var(--brill-navy)" }} />;
  }

  if (!session) {
    return <Login clientName={PROPS.clientName} onSuccess={setSession} />;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh", background: "var(--surface-muted)" }}>
      <Sidebar clientName={PROPS.clientName} view={view} onNavigate={setView} onLogout={handleLogout} />

      <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header
          overline={v.overline}
          title={v.title}
          sub={v.sub}
          showDateFilter={view === "dash"}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
        />

        <div style={{ padding: "var(--space-6) var(--space-7) var(--space-9)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {view === "dash" && <Dashboard dateFrom={dateFrom} dateTo={dateTo} showTargets={PROPS.showBenchmarkTargets} />}
          {view === "pipe" && <Pipeline showDedupeFlags={PROPS.showDedupeFlags} onOpenLead={openLead} />}
          {view === "post" && <PostCE />}
          {view === "record" && (
            <LeadRecord
              leadKey={leadKey}
              onSelectLead={setLeadKey}
              aiTab={aiTab}
              onAiTab={setAiTab}
              showAi={PROPS.showAiPanel}
            />
          )}
          {view === "map" && <FunnelMap />}
          {view === "road" && <Roadmap />}
        </div>
      </main>
    </div>
  );
}
