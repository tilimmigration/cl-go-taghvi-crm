import { useState } from "react";
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

const PROPS = {
  clientName: "Taghavi Immigration Law",
  showAiPanel: true,
  showDedupeFlags: true,
  showBenchmarkTargets: true,
};

const AUTH_KEY = "taghavi-crm-authed";

export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === "true");
  const [view, setView] = useState("dash");
  const [tf, setTf] = useState("month");
  const [aiTab, setAiTab] = useState("summary");
  const [leadKey, setLeadKey] = useState("ana");

  const v = VIEWS[view];

  function openLead(key) {
    setLeadKey(key);
    setView("record");
  }

  function handleLoginSuccess() {
    sessionStorage.setItem(AUTH_KEY, "true");
    setAuthed(true);
  }

  if (!authed) {
    return <Login clientName={PROPS.clientName} onSuccess={handleLoginSuccess} />;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh", background: "var(--surface-muted)" }}>
      <Sidebar clientName={PROPS.clientName} view={view} onNavigate={setView} />

      <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header
          overline={v.overline}
          title={v.title}
          sub={v.sub}
          showTimeframe={view === "dash"}
          tf={tf}
          onTf={setTf}
        />

        <div style={{ padding: "var(--space-6) var(--space-7) var(--space-9)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {view === "dash" && <Dashboard tf={tf} showTargets={PROPS.showBenchmarkTargets} />}
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
