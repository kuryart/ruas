import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Users, CheckSquare, Calendar as CalIcon, FileText, Mail, Wallet, Layers,
  Settings, Search, Plus, Star, Inbox, Send, AlertOctagon, Trash2, Reply,
  Forward, MoreHorizontal, X, ChevronRight, Paperclip, Link2, Hash, Clock,
  MapPin, Phone, AtSign, Building2, Tag, ArrowUpRight, ArrowDownRight,
  TrendingUp, Filter, Sparkles,
} from "lucide-react";
import {
  contacts, tasks, events, notes, emails, accounts, transactions, projects,
  type ModuleId, type Note, type Email, type Contact, type Project,
} from "@/lib/workspace-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — Workspace" },
      { name: "description", content: "Workspace de produtividade inspirado no Obsidian, com Catppuccin." },
    ],
  }),
  component: Workspace,
});

/* ============================================================
   Modules config
   ============================================================ */
const MODULES: { id: ModuleId; label: string; icon: typeof Users; accent: string }[] = [
  { id: "contacts",  label: "Contatos",   icon: Users,       accent: "ctp-pink" },
  { id: "agenda",    label: "Agenda",     icon: CheckSquare, accent: "ctp-peach" },
  { id: "calendar",  label: "Calendário", icon: CalIcon,     accent: "ctp-blue" },
  { id: "notes",     label: "Notas",      icon: FileText,    accent: "ctp-yellow" },
  { id: "emails",    label: "Emails",     icon: Mail,        accent: "ctp-sky" },
  { id: "finance",   label: "Finanças",   icon: Wallet,      accent: "ctp-green" },
  { id: "projects",  label: "Projetos",   icon: Layers,      accent: "ctp-mauve" },
];

/* ============================================================
   Tab model
   ============================================================ */
interface Tab {
  id: string;
  module: ModuleId;
  title: string;
  payload: any;
}

const initialTab = (module: ModuleId, payload?: any, title?: string): Tab => ({
  id: `${module}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  module,
  title: title ?? defaultTitle(module, payload),
  payload,
});

function defaultTitle(module: ModuleId, payload: any): string {
  switch (module) {
    case "contacts":  return payload?.name ?? "Contatos";
    case "agenda":    return "Hoje";
    case "calendar":  return payload?.title ?? "Calendário";
    case "notes":     return payload?.title ?? "Nota";
    case "emails":    return "Caixa de entrada";
    case "finance":   return payload?.view === "accounts" ? "Contas" : "Transações";
    case "projects":  return payload?.name ?? "Projetos";
  }
}

/* ============================================================
   Root workspace
   ============================================================ */
function Workspace() {
  const [activeModule, setActiveModule] = useState<ModuleId>("notes");
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([
    initialTab("notes", notes[0], notes[0].title),
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);

  // Left-panel "view" selection (e.g., emails folder, agenda bucket, finance view)
  const [subView, setSubView] = useState<Record<ModuleId, string>>({
    contacts: "all", agenda: "today", calendar: "today", notes: "all",
    emails: "inbox", finance: "transactions", projects: "all",
  });

  const activeTab = tabs.find(t => t.id === activeTabId);

  const openTab = (module: ModuleId, payload?: any, title?: string) => {
    // de-dup tabs that point to the same payload id
    const key = payload?.id ?? `${module}:${title ?? ""}`;
    const existing = tabs.find(t => (t.payload?.id ?? `${t.module}:${t.title}`) === key && t.module === module);
    if (existing) { setActiveTabId(existing.id); setActiveModule(module); return; }
    const t = initialTab(module, payload, title);
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
    setActiveModule(module);
  };

  const closeTab = (id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const fresh = initialTab(activeModule);
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeTabId) {
        const neighbor = next[Math.max(0, idx - 1)];
        setActiveTabId(neighbor.id);
        setActiveModule(neighbor.module);
      }
      return next;
    });
  };

  const switchModule = (m: ModuleId) => {
    setActiveModule(m);
    // open a default tab for that module if none exists
    const has = tabs.some(t => t.module === m);
    if (!has) {
      const def = defaultPayloadForModule(m);
      openTab(m, def.payload, def.title);
    } else {
      const t = tabs.find(t => t.module === m)!;
      setActiveTabId(t.id);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      <IconSidebar active={activeModule} onSelect={switchModule} />
      <LeftPanel
        module={activeModule}
        query={query}
        setQuery={setQuery}
        subView={subView[activeModule]}
        setSubView={(v) => setSubView(s => ({ ...s, [activeModule]: v }))}
        onOpen={openTab}
      />
      <MiddlePanel
        tabs={tabs}
        activeTabId={activeTabId}
        setActiveTabId={(id) => {
          setActiveTabId(id);
          const t = tabs.find(t => t.id === id);
          if (t) setActiveModule(t.module);
        }}
        closeTab={closeTab}
        activeTab={activeTab}
        openTab={openTab}
      />
      <RightPanel activeTab={activeTab} />
    </div>
  );
}

function defaultPayloadForModule(m: ModuleId): { payload: any; title: string } {
  switch (m) {
    case "contacts": return { payload: contacts[0], title: contacts[0].name };
    case "agenda":   return { payload: null, title: "Hoje" };
    case "calendar": return { payload: null, title: "Calendário" };
    case "notes":    return { payload: notes[0], title: notes[0].title };
    case "emails":   return { payload: null, title: "Caixa de entrada" };
    case "finance":  return { payload: { view: "transactions" }, title: "Transações" };
    case "projects": return { payload: projects[0], title: projects[0].name };
  }
}

/* ============================================================
   Icon sidebar
   ============================================================ */
function IconSidebar({ active, onSelect }: { active: ModuleId; onSelect: (m: ModuleId) => void }) {
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center justify-between border-r border-border/60 bg-[var(--ctp-crust)] py-3">
      <div className="flex flex-col items-center gap-1">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-ctp-mauve to-ctp-blue text-[var(--ctp-crust)] shadow-lg shadow-ctp-mauve/20">
          <Sparkles size={18} strokeWidth={2.4} />
        </div>
        {MODULES.map(m => {
          const Icon = m.icon;
          const isActive = active === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              title={m.label}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
                isActive
                  ? "bg-[var(--ctp-surface0)] text-[var(--color-foreground)]"
                  : "text-muted-foreground hover:bg-[var(--ctp-surface0)]/50 hover:text-foreground"
              }`}
            >
              {isActive && (
                <span
                  className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full"
                  style={{ backgroundColor: `var(--${m.accent})` }}
                />
              )}
              <Icon size={18} strokeWidth={isActive ? 2.4 : 1.8} />
            </button>
          );
        })}
      </div>
      <button
        title="Configurações"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--ctp-surface0)]/50 hover:text-foreground"
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
    </aside>
  );
}

/* ============================================================
   LEFT PANEL — context-dependent list
   ============================================================ */
function LeftPanel({
  module, query, setQuery, subView, setSubView, onOpen,
}: {
  module: ModuleId; query: string; setQuery: (s: string) => void;
  subView: string; setSubView: (s: string) => void;
  onOpen: (m: ModuleId, payload?: any, title?: string) => void;
}) {
  const moduleMeta = MODULES.find(m => m.id === module)!;

  return (
    <aside className="flex h-full w-[20%] min-w-[260px] shrink-0 flex-col border-r border-border/60 bg-[var(--ctp-mantle)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: `var(--${moduleMeta.accent})` }}
          />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
            {moduleMeta.label}
          </h2>
        </div>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-[var(--ctp-surface0)] hover:text-foreground">
          <Plus size={15} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-[var(--ctp-base)] px-2.5 py-1.5 focus-within:border-ctp-mauve/50">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Buscar em ${moduleMeta.label.toLowerCase()}…`}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground sm:inline">⌘K</kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {module === "contacts"  && <ContactsList q={query} onOpen={onOpen} />}
        {module === "agenda"    && <AgendaList q={query} sub={subView} setSub={setSubView} onOpen={onOpen} />}
        {module === "calendar"  && <CalendarToday q={query} onOpen={onOpen} />}
        {module === "notes"     && <NotesList q={query} onOpen={onOpen} />}
        {module === "emails"    && <EmailFolders q={query} sub={subView} setSub={setSubView} onOpen={onOpen} />}
        {module === "finance"   && <FinanceList q={query} sub={subView} setSub={setSubView} onOpen={onOpen} />}
        {module === "projects"  && <ProjectsList q={query} onOpen={onOpen} />}
      </div>
    </aside>
  );
}

const matches = (q: string, ...fields: string[]) =>
  q.trim() === "" || fields.some(f => f.toLowerCase().includes(q.toLowerCase()));

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
      {children}
    </div>
  );
}

function ListBtn({
  children, active, onClick, count, icon: Icon,
}: {
  children: React.ReactNode; active?: boolean; onClick?: () => void;
  count?: number; icon?: typeof Inbox;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
        active ? "bg-[var(--ctp-surface0)] text-foreground" : "text-muted-foreground hover:bg-[var(--ctp-surface0)]/60 hover:text-foreground"
      }`}
    >
      {Icon && <Icon size={14} className={active ? "text-ctp-mauve" : ""} />}
      <span className="flex-1 truncate text-left">{children}</span>
      {typeof count === "number" && (
        <span className="font-mono text-[10.5px] text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

/* ---------- Contacts list ---------- */
function ContactsList({ q, onOpen }: { q: string; onOpen: any }) {
  const filtered = contacts.filter(c => matches(q, c.name, c.company, c.role, c.email));
  return (
    <div className="flex flex-col gap-0.5">
      {filtered.map(c => (
        <button
          key={c.id}
          onClick={() => onOpen("contacts", c, c.name)}
          className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--ctp-surface0)]/60"
        >
          <Avatar name={c.name} color={c.avatarColor} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">{c.name}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">{c.role} · {c.company}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ---------- Agenda buckets ---------- */
function AgendaList({ q, sub, setSub, onOpen }: { q: string; sub: string; setSub: (s: string) => void; onOpen: any }) {
  const buckets = [
    { id: "inbox",  label: "Caixa de entrada", icon: Inbox },
    { id: "today",  label: "Hoje",             icon: Clock },
    { id: "soon",   label: "Em breve",         icon: CalIcon },
  ];
  const counts = useMemo(() => ({
    inbox: tasks.filter(t => t.bucket === "inbox" && !t.done).length,
    today: tasks.filter(t => t.bucket === "today" && !t.done).length,
    soon:  tasks.filter(t => t.bucket === "soon"  && !t.done).length,
  }), []);
  const items = tasks.filter(t => t.bucket === sub && matches(q, t.title, t.project ?? ""));
  return (
    <div>
      {buckets.map(b => (
        <ListBtn key={b.id} icon={b.icon} active={sub === b.id} count={(counts as any)[b.id]}
          onClick={() => { setSub(b.id); onOpen("agenda", { bucket: b.id }, b.label); }}>
          {b.label}
        </ListBtn>
      ))}
      <SectionLabel>Pré-visualização</SectionLabel>
      <div className="flex flex-col gap-0.5 px-1">
        {items.slice(0, 6).map(t => (
          <div key={t.id} className="rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground">
            <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${t.done ? "bg-ctp-green" : "bg-ctp-peach"}`} />
            {t.title}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Calendar today ---------- */
function CalendarToday({ q, onOpen }: { q: string; onOpen: any }) {
  const items = events.filter(e => matches(q, e.title, e.location ?? ""));
  return (
    <div>
      <SectionLabel>Eventos de hoje</SectionLabel>
      <div className="flex flex-col gap-1 px-1">
        {items.map(e => (
          <button
            key={e.id}
            onClick={() => onOpen("calendar", e, e.title)}
            className="group flex items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--ctp-surface0)]/60"
          >
            <div className="mt-0.5 w-12 font-mono text-[11px] text-muted-foreground">{e.time}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(--${e.color})` }} />
                <span className="truncate text-[13px] font-medium text-foreground">{e.title}</span>
              </div>
              {e.location && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{e.location}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Notes list ---------- */
function NotesList({ q, onOpen }: { q: string; onOpen: any }) {
  const items = notes.filter(n => matches(q, n.title, n.preview, ...n.tags));
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(n => (
        <button
          key={n.id}
          onClick={() => onOpen("notes", n, n.title)}
          className="group flex flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--ctp-surface0)]/60"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{n.title}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{n.updated}</span>
          </div>
          <p className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{n.preview}</p>
        </button>
      ))}
    </div>
  );
}

/* ---------- Emails folders ---------- */
function EmailFolders({ q, sub, setSub, onOpen }: { q: string; sub: string; setSub: (s: string) => void; onOpen: any }) {
  const folders = [
    { id: "inbox",   label: "Caixa de entrada", icon: Inbox },
    { id: "sent",    label: "Enviados",          icon: Send },
    { id: "starred", label: "Favoritos",         icon: Star },
    { id: "spam",    label: "Spam",              icon: AlertOctagon },
    { id: "trash",   label: "Lixeira",           icon: Trash2 },
  ];
  const counts = useMemo(() => {
    const c: any = {};
    folders.forEach(f => {
      c[f.id] = f.id === "starred"
        ? emails.filter(e => e.starred).length
        : emails.filter(e => e.folder === f.id).length;
    });
    return c;
  }, []);
  const items = (sub === "starred"
    ? emails.filter(e => e.starred)
    : emails.filter(e => e.folder === sub)
  ).filter(e => matches(q, e.subject, e.from, e.preview));

  return (
    <div>
      {folders.map(f => (
        <ListBtn key={f.id} icon={f.icon} active={sub === f.id} count={counts[f.id]}
          onClick={() => { setSub(f.id); onOpen("emails", { folder: f.id }, f.label); }}>
          {f.label}
        </ListBtn>
      ))}
      <SectionLabel>Etiquetas</SectionLabel>
      {["Trabalho", "Pessoal", "Financeiro"].map(l => (
        <ListBtn key={l} icon={Tag}>{l}</ListBtn>
      ))}
      <div className="mt-2 px-2 text-[10.5px] text-muted-foreground/70">
        {items.length} {items.length === 1 ? "email" : "emails"} em vista
      </div>
    </div>
  );
}

/* ---------- Finance ---------- */
function FinanceList({ q, sub, setSub, onOpen }: { q: string; sub: string; setSub: (s: string) => void; onOpen: any }) {
  return (
    <div>
      <ListBtn icon={Wallet} active={sub === "accounts"}
        onClick={() => { setSub("accounts"); onOpen("finance", { view: "accounts" }, "Contas"); }}>
        Contas
      </ListBtn>
      <ListBtn icon={TrendingUp} active={sub === "transactions"}
        onClick={() => { setSub("transactions"); onOpen("finance", { view: "transactions" }, "Transações"); }}>
        Transações
      </ListBtn>
      <SectionLabel>Saldo total</SectionLabel>
      <div className="mx-2 rounded-md border border-border/60 bg-[var(--ctp-base)] p-3">
        <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">Patrimônio</div>
        <div className="mt-1 font-display text-xl font-semibold text-ctp-green">
          R$ {accounts.reduce((s, a) => s + a.balance, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{accounts.length} contas ativas</div>
      </div>
      <SectionLabel>Contas</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {accounts.filter(a => matches(q, a.name)).map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--${a.color})` }} />
              <span className="truncate text-foreground">{a.name}</span>
            </div>
            <span className={`font-mono text-[11px] ${a.balance < 0 ? "text-ctp-red" : "text-muted-foreground"}`}>
              {a.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Projects list ---------- */
function ProjectsList({ q, onOpen }: { q: string; onOpen: any }) {
  const items = projects.filter(p => matches(q, p.name, p.description));
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(p => (
        <button
          key={p.id}
          onClick={() => onOpen("projects", p, p.name)}
          className="group flex flex-col gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--ctp-surface0)]/60"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(--${p.color})` }} />
            <span className="flex-1 truncate text-[13px] font-medium text-foreground">{p.name}</span>
            <StatusPill status={p.status} />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--ctp-surface0)]">
              <div className="h-full rounded-full" style={{ width: `${p.progress}%`, backgroundColor: `var(--${p.color})` }} />
            </div>
            <span className="font-mono text-[10.5px] text-muted-foreground">{p.progress}%</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: Project["status"] }) {
  const map: Record<Project["status"], { label: string; color: string }> = {
    active:    { label: "Ativo",    color: "ctp-green" },
    "on-hold": { label: "Pausa",    color: "ctp-yellow" },
    done:      { label: "Concluído",color: "ctp-overlay1" },
  };
  const m = map[status];
  return (
    <span className="rounded-full border border-border/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider"
          style={{ color: `var(--${m.color})` }}>
      {m.label}
    </span>
  );
}

/* ============================================================
   MIDDLE PANEL — browser-like tabs + content
   ============================================================ */
function MiddlePanel({
  tabs, activeTabId, setActiveTabId, closeTab, activeTab, openTab,
}: {
  tabs: Tab[]; activeTabId: string; setActiveTabId: (id: string) => void;
  closeTab: (id: string) => void; activeTab?: Tab; openTab: any;
}) {
  return (
    <main className="flex h-full flex-1 flex-col bg-background min-w-0">
      {/* Tab bar */}
      <div className="flex h-10 shrink-0 items-end gap-1 border-b border-border/60 bg-[var(--ctp-mantle)] pl-2 pr-2 pt-1.5">
        <div className="flex flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map(t => {
            const meta = MODULES.find(m => m.id === t.module)!;
            const Icon = meta.icon;
            const isActive = t.id === activeTabId;
            return (
              <div
                key={t.id}
                onClick={() => setActiveTabId(t.id)}
                className={`group relative flex h-8 min-w-[140px] max-w-[220px] cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-[12.5px] transition-colors ${
                  isActive
                    ? "border-border/60 bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-[var(--ctp-surface0)]/40 hover:text-foreground"
                }`}
              >
                <Icon size={12} style={{ color: `var(--${meta.accent})` }} />
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  className="rounded p-0.5 opacity-0 transition hover:bg-[var(--ctp-surface1)] group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
                {isActive && (
                  <span className="absolute -bottom-px left-0 right-0 h-px bg-background" />
                )}
              </div>
            );
          })}
          <button
            onClick={() => {
              const def = defaultPayloadForModule(activeTab?.module ?? "notes");
              openTab(activeTab?.module ?? "notes", def.payload, def.title);
            }}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--ctp-surface0)] hover:text-foreground"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab && <TabContent tab={activeTab} />}
      </div>
    </main>
  );
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab.module) {
    case "contacts":  return <ContactView contact={tab.payload as Contact} />;
    case "agenda":    return <AgendaView bucket={tab.payload?.bucket ?? "today"} />;
    case "calendar":  return tab.payload ? <EventView event={tab.payload} /> : <CalendarView />;
    case "notes":     return <NoteView note={tab.payload as Note} />;
    case "emails":    return <EmailListView folder={tab.payload?.folder ?? "inbox"} />;
    case "finance":   return tab.payload?.view === "accounts" ? <AccountsView /> : <TransactionsView />;
    case "projects":  return <ProjectView project={tab.payload as Project} />;
  }
}

/* ---------- Avatar ---------- */
function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-[var(--ctp-crust)]"
      style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: `var(--${color})` }}
    >
      {initials}
    </div>
  );
}

/* ---------- Contact view ---------- */
function ContactView({ contact }: { contact: Contact }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="flex items-start gap-5">
        <Avatar name={contact.name} color={contact.avatarColor} size={72} />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-semibold text-foreground">{contact.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contact.role} · {contact.company}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {contact.tags.map(t => (
              <span key={t} className="rounded-md border border-border/60 bg-[var(--ctp-surface0)]/50 px-2 py-0.5 font-mono text-[10.5px] text-ctp-lavender">
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field icon={AtSign}    label="Email" value={contact.email} />
        <Field icon={Phone}     label="Telefone" value={contact.phone} />
        <Field icon={Building2} label="Empresa" value={contact.company} />
        <Field icon={Hash}      label="ID" value={contact.id} />
      </div>
      <div className="mt-8">
        <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Notas</h3>
        <p className="rounded-lg border border-border/60 bg-[var(--ctp-mantle)] p-4 text-[14px] leading-relaxed text-foreground/90">
          {contact.notes}
        </p>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-[var(--ctp-mantle)] p-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon size={11} /> {label}
      </div>
      <div className="mt-1 font-mono text-[13px] text-foreground">{value}</div>
    </div>
  );
}

/* ---------- Agenda view (task list) ---------- */
function AgendaView({ bucket }: { bucket: string }) {
  const [items, setItems] = useState(tasks);
  const list = items.filter(t => t.bucket === bucket);
  const labels: any = { inbox: "Caixa de entrada", today: "Hoje", soon: "Em breve" };
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="font-display text-2xl font-semibold text-foreground">{labels[bucket]}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{list.filter(t => !t.done).length} tarefas pendentes</p>

      <div className="mt-6 flex flex-col">
        {list.map(t => (
          <label key={t.id}
            className="group flex cursor-pointer items-center gap-3 border-b border-border/40 py-3 transition-colors hover:bg-[var(--ctp-mantle)]/60">
            <button
              onClick={() => setItems(p => p.map(x => x.id === t.id ? { ...x, done: !x.done } : x))}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                t.done ? "border-ctp-green bg-ctp-green text-[var(--ctp-crust)]" : "border-border bg-transparent hover:border-ctp-mauve"
              }`}
            >
              {t.done && <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <span className={`flex-1 text-[14px] ${t.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.title}</span>
            {t.project && (
              <span className="rounded-md bg-[var(--ctp-surface0)] px-1.5 py-0.5 font-mono text-[10px] text-ctp-mauve">
                {t.project}
              </span>
            )}
            {t.due && <span className="font-mono text-[11px] text-muted-foreground">{t.due}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

/* ---------- Calendar view ---------- */
function CalendarView() {
  const days = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
  const today = 8; // monday-based index of "today"
  // Build a 5-week month grid starting offset
  const cells = Array.from({ length: 35 }, (_, i) => i + 1 - 3); // offset
  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Junho 2026</h1>
          <p className="mt-1 text-sm text-muted-foreground">{events.length} eventos esta semana</p>
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Hoje</button>
          <button className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Mês</button>
          <button className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">Semana</button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border/60 bg-[var(--ctp-mantle)]">
        <div className="grid grid-cols-7 border-b border-border/60">
          {days.map(d => (
            <div key={d} className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const valid = c > 0 && c <= 30;
            const isToday = c === today;
            const hasEvents = valid && [3, 8, 12, 17, 21, 25].includes(c);
            return (
              <div key={i} className={`relative min-h-[88px] border-b border-r border-border/40 p-2 ${i % 7 === 6 ? "border-r-0" : ""}`}>
                <div className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ${
                  isToday ? "bg-ctp-mauve text-[var(--ctp-crust)] font-semibold" : valid ? "text-foreground" : "text-muted-foreground/40"
                }`}>
                  {valid ? c : ""}
                </div>
                {hasEvents && (
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="truncate rounded bg-ctp-blue/20 px-1.5 py-0.5 text-[10.5px] text-ctp-blue">Daily</div>
                    {c === today && <div className="truncate rounded bg-ctp-mauve/20 px-1.5 py-0.5 text-[10.5px] text-ctp-mauve">1:1 Camila</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventView({ event }: { event: any }) {
  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(--${event.color})` }} />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Evento · Hoje</span>
      </div>
      <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">{event.title}</h1>
      <div className="mt-4 flex flex-wrap gap-3 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Clock size={13} /> {event.time}–{event.endTime}</span>
        {event.location && <span className="flex items-center gap-1.5"><MapPin size={13} /> {event.location}</span>}
      </div>
      {event.attendees && (
        <div className="mt-6">
          <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Participantes</div>
          <div className="flex -space-x-2">
            {event.attendees.map((a: string, i: number) => (
              <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-[var(--ctp-surface1)] font-display text-[11px] font-semibold text-foreground">
                {a}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Note view ---------- */
function NoteView({ note }: { note: Note }) {
  return (
    <article className="mx-auto max-w-3xl px-10 py-12">
      <div className="flex flex-wrap items-center gap-1.5">
        {note.tags.map(t => (
          <span key={t} className="rounded-md border border-border/60 bg-[var(--ctp-surface0)]/50 px-2 py-0.5 font-mono text-[10.5px] text-ctp-lavender">#{t}</span>
        ))}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">atualizada {note.updated}</span>
      </div>
      <div
        className="mt-5 font-sans text-[15px] leading-[1.75] text-foreground/90"
      >
        {note.body.split("\n").map((line, i) => {
          if (line.startsWith("# "))    return <h1 key={i} className="mt-0 mb-4 font-display text-3xl font-bold text-foreground">{line.slice(2)}</h1>;
          if (line.startsWith("## "))   return <h2 key={i} className="mt-6 mb-2 font-display text-xl font-semibold text-foreground">{line.slice(3)}</h2>;
          if (line.match(/^\d+\. /))    return <p key={i} className="my-1.5 pl-5"><span className="font-mono text-ctp-mauve">{line.match(/^\d+/)?.[0]}.</span> {renderInline(line.replace(/^\d+\. /, ""))}</p>;
          if (line.startsWith("- "))    return <p key={i} className="my-1 pl-5"><span className="text-ctp-mauve">•</span> {renderInline(line.slice(2))}</p>;
          if (line.trim() === "")       return <div key={i} className="h-3" />;
          return <p key={i} className="my-2">{renderInline(line)}</p>;
        })}
      </div>
    </article>
  );
}

function renderInline(text: string): React.ReactNode {
  // [[link]] and **bold**
  const parts: React.ReactNode[] = [];
  const re = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tk = m[0];
    if (tk.startsWith("[[")) parts.push(<a key={k++} className="rounded px-1 text-ctp-mauve underline decoration-ctp-mauve/40 hover:bg-ctp-mauve/10">{tk.slice(2, -2)}</a>);
    else parts.push(<strong key={k++} className="font-semibold text-foreground">{tk.slice(2, -2)}</strong>);
    last = m.index + tk.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* ---------- Email list view ---------- */
function EmailListView({ folder }: { folder: string }) {
  const list = folder === "starred"
    ? emails.filter(e => e.starred)
    : emails.filter(e => e.folder === folder);
  const [selected, setSelected] = useState<string | null>(null);
  const email = list.find(e => e.id === selected);

  if (email) return <EmailView email={email} onBack={() => setSelected(null)} />;

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-foreground">
          {folder === "inbox" ? "Caixa de entrada" : folder === "sent" ? "Enviados" : folder === "starred" ? "Favoritos" : folder === "spam" ? "Spam" : "Lixeira"}
        </h1>
        <button className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">
          <Filter size={12} /> Filtrar
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {list.map(e => (
          <button
            key={e.id}
            onClick={() => setSelected(e.id)}
            className={`flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--ctp-mantle)] ${e.unread ? "bg-[var(--ctp-mantle)]/40" : ""}`}
          >
            <Avatar name={e.from} color="ctp-blue" size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`truncate text-[13px] ${e.unread ? "font-semibold text-foreground" : "text-foreground/80"}`}>{e.from}</span>
                {e.starred && <Star size={12} className="text-ctp-yellow" fill="currentColor" />}
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground">{e.time}</span>
              </div>
              <div className={`truncate text-[13px] ${e.unread ? "text-foreground" : "text-foreground/70"}`}>{e.subject}</div>
              <div className="truncate text-[12px] text-muted-foreground">{e.preview}</div>
            </div>
            {e.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ctp-mauve" />}
          </button>
        ))}
        {list.length === 0 && (
          <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">Nenhum email aqui.</div>
        )}
      </div>
    </div>
  );
}

function EmailView({ email, onBack }: { email: Email; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
        <ChevronRight size={12} className="rotate-180" /> Voltar
      </button>
      <h1 className="font-display text-2xl font-semibold text-foreground">{email.subject}</h1>
      <div className="mt-4 flex items-center gap-3 border-b border-border/60 pb-4">
        <Avatar name={email.from} color="ctp-blue" />
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-foreground">{email.from}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{email.fromEmail} · {email.time}</div>
        </div>
        <div className="flex items-center gap-1">
          {[Reply, Forward, Star, MoreHorizontal].map((Ic, i) => (
            <button key={i} className="rounded-md p-1.5 text-muted-foreground hover:bg-[var(--ctp-surface0)] hover:text-foreground"><Ic size={14} /></button>
          ))}
        </div>
      </div>
      <div className="prose-invert mt-6 whitespace-pre-wrap text-[14px] leading-[1.7] text-foreground/90">
        {email.body}
      </div>
    </div>
  );
}

/* ---------- Finance views ---------- */
function TransactionsView() {
  return (
    <div className="px-6 py-6">
      <h1 className="font-display text-xl font-semibold text-foreground">Transações</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Junho de 2026</p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border/60">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border/60 bg-[var(--ctp-mantle)] text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(t => (
              <tr key={t.id} className="border-b border-border/40 last:border-b-0 hover:bg-[var(--ctp-mantle)]/40">
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-muted-foreground">{t.date}</td>
                <td className="px-3 py-2.5 text-foreground">{t.description}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded-md bg-[var(--ctp-surface0)] px-1.5 py-0.5 font-mono text-[10.5px] text-ctp-lavender">{t.category}</span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{t.account}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${t.amount < 0 ? "text-ctp-red" : "text-ctp-green"}`}>
                  {t.amount < 0 ? <ArrowDownRight size={11} className="inline mr-0.5" /> : <ArrowUpRight size={11} className="inline mr-0.5" />}
                  {Math.abs(t.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountsView() {
  return (
    <div className="px-6 py-6">
      <h1 className="font-display text-xl font-semibold text-foreground">Contas</h1>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accounts.map(a => (
          <div key={a.id} className="rounded-lg border border-border/60 bg-[var(--ctp-mantle)] p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{a.type}</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(--${a.color})` }} />
            </div>
            <div className="mt-2 font-display text-base font-medium text-foreground">{a.name}</div>
            <div className={`mt-3 font-display text-2xl font-semibold ${a.balance < 0 ? "text-ctp-red" : "text-foreground"}`}>
              R$ {a.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Project view (Kanban) ---------- */
function ProjectView({ project }: { project: Project }) {
  const [view, setView] = useState<"kanban" | "details">("kanban");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(--${project.color})` }} />
          <h1 className="font-display text-xl font-semibold text-foreground">{project.name}</h1>
          <StatusPill status={project.status} />
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 p-0.5">
            {["kanban", "details"].map(v => (
              <button key={v}
                onClick={() => setView(v as any)}
                className={`rounded px-2 py-0.5 text-[11.5px] capitalize ${view === v ? "bg-[var(--ctp-surface0)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {v === "kanban" ? "Kanban" : "Detalhes"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">{project.description}</p>
      </div>

      {view === "kanban" ? (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {project.columns.map(col => (
            <div key={col.id} className="flex w-64 shrink-0 flex-col rounded-lg bg-[var(--ctp-mantle)] p-2.5">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{col.title}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{col.cards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {col.cards.map(card => (
                  <div key={card.id} className="rounded-md border border-border/60 bg-[var(--ctp-base)] p-2.5 text-[13px] text-foreground hover:border-ctp-mauve/50">
                    {card.title}
                    {card.tag && (
                      <div className="mt-1.5">
                        <span className="rounded bg-[var(--ctp-surface0)] px-1.5 py-0.5 font-mono text-[10px] text-ctp-lavender">{card.tag}</span>
                      </div>
                    )}
                  </div>
                ))}
                <button className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border/60 py-1.5 text-[11.5px] text-muted-foreground hover:border-ctp-mauve/50 hover:text-foreground">
                  <Plus size={11} /> Novo
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl flex-1 px-8 py-8">
          <Field icon={CalIcon} label="Entrega" value={project.due} />
          <div className="mt-4">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Progresso</div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--ctp-surface0)]">
              <div className="h-full rounded-full" style={{ width: `${project.progress}%`, backgroundColor: `var(--${project.color})` }} />
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{project.progress}% concluído</div>
          </div>
          <div className="mt-6">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Equipe</div>
            <div className="flex -space-x-2">
              {project.team.map((m, i) => (
                <div key={i} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-[var(--ctp-surface1)] font-display text-[12px] font-semibold text-foreground">
                  {m}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   RIGHT PANEL
   ============================================================ */
function RightPanel({ activeTab }: { activeTab?: Tab }) {
  return (
    <aside className="flex h-full w-[20%] min-w-[260px] shrink-0 flex-col border-l border-border/60 bg-[var(--ctp-mantle)]">
      {activeTab?.module === "emails" && activeTab.payload?.folder
        ? <RightEmail />
        : <RightSummary tab={activeTab} />}
    </aside>
  );
}

function RightSummary({ tab }: { tab?: Tab }) {
  const meta = tab ? MODULES.find(m => m.id === tab.module)! : null;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Resumo</div>
        <div className="mt-0.5 font-display text-[13px] font-semibold text-foreground">{tab?.title ?? "—"}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab?.module === "notes" && <NoteBacklinks note={tab.payload as Note} />}
        {tab?.module === "contacts" && <ContactSummary contact={tab.payload as Contact} />}
        {tab?.module === "projects" && <ProjectSummary project={tab.payload as Project} />}
        {tab?.module === "agenda" && <GenericSummary title="Foco do dia" items={[
          { label: "Tarefas", value: `${tasks.filter(t => t.bucket === "today" && !t.done).length} pendentes` },
          { label: "Concluídas", value: `${tasks.filter(t => t.bucket === "today" && t.done).length}` },
          { label: "Tempo estimado", value: "3h 20min" },
        ]}/>}
        {tab?.module === "calendar" && <GenericSummary title="Hoje" items={[
          { label: "Eventos", value: `${events.length}` },
          { label: "Tempo em reuniões", value: "4h 30min" },
          { label: "Foco livre", value: "2h" },
        ]}/>}
        {tab?.module === "finance" && <FinanceSummary />}
        {!tab && <div className="text-[13px] text-muted-foreground">Selecione um item para ver o resumo.</div>}

        {meta && (
          <div className="mt-6 rounded-lg border border-border/60 bg-[var(--ctp-base)] p-3">
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="text-ctp-mauve" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Sugestão</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/80">
              Use <kbd className="rounded border border-border/60 px-1 font-mono text-[10px]">⌘P</kbd> para abrir a paleta de comandos e navegar entre módulos sem sair do teclado.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function GenericSummary({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div>
      <div className="font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {items.map(i => (
          <div key={i.label} className="flex items-center justify-between border-b border-border/40 py-1.5 text-[13px]">
            <span className="text-muted-foreground">{i.label}</span>
            <span className="font-mono text-foreground">{i.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteBacklinks({ note }: { note: Note }) {
  return (
    <div>
      <div className="font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Sumário</div>
      <ul className="mt-2 space-y-1 border-l border-border/60 pl-3 text-[12.5px] text-muted-foreground">
        {note.body.split("\n").filter(l => l.startsWith("#")).map((l, i) => (
          <li key={i} className={l.startsWith("## ") ? "pl-3 text-foreground/70" : "font-medium text-foreground"}>
            {l.replace(/^#+\s/, "")}
          </li>
        ))}
      </ul>

      <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Backlinks</div>
      <div className="mt-2 flex flex-col gap-1">
        {note.backlinks.length === 0 && <div className="text-[12.5px] text-muted-foreground">Nenhum backlink ainda.</div>}
        {note.backlinks.map(b => (
          <button key={b} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/90 hover:bg-[var(--ctp-surface0)]/60">
            <Link2 size={12} className="text-ctp-mauve" />
            <span className="truncate">{b}</span>
            <ArrowUpRight size={11} className="ml-auto opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {note.tags.map(t => (
          <span key={t} className="rounded-md border border-border/60 bg-[var(--ctp-surface0)]/40 px-2 py-0.5 font-mono text-[10.5px] text-ctp-lavender">#{t}</span>
        ))}
      </div>
    </div>
  );
}

function ContactSummary({ contact }: { contact: Contact }) {
  return (
    <div>
      <div className="font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Atividade recente</div>
      <ul className="mt-2 space-y-2 text-[12.5px] text-muted-foreground">
        <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ctp-green" /> Email respondido <span className="ml-auto font-mono text-[10.5px]">2h</span></li>
        <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ctp-blue" /> Reunião agendada <span className="ml-auto font-mono text-[10.5px]">ontem</span></li>
        <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ctp-mauve" /> Nota vinculada <span className="ml-auto font-mono text-[10.5px]">3d</span></li>
      </ul>

      <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Backlinks</div>
      <div className="mt-2 flex flex-col gap-1">
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--ctp-surface0)]/60">
          <Link2 size={12} className="text-ctp-mauve" /> Briefing — {contact.company}
        </button>
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--ctp-surface0)]/60">
          <Link2 size={12} className="text-ctp-mauve" /> Reunião {contact.name.split(" ")[0]}
        </button>
      </div>
    </div>
  );
}

function ProjectSummary({ project }: { project: Project }) {
  const total = project.columns.reduce((s, c) => s + c.cards.length, 0);
  return (
    <div>
      <GenericSummary title="Indicadores" items={[
        { label: "Cartões",    value: `${total}` },
        { label: "Progresso",  value: `${project.progress}%` },
        { label: "Entrega",    value: project.due },
        { label: "Equipe",     value: `${project.team.length} pessoas` },
      ]}/>
      <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Backlinks</div>
      <div className="mt-2 flex flex-col gap-1">
        {["Briefing inicial", "Reunião de kick-off", "Notas — retrospectiva"].map(b => (
          <button key={b} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--ctp-surface0)]/60">
            <Link2 size={12} className="text-ctp-mauve" /> {b}
          </button>
        ))}
      </div>
    </div>
  );
}

function FinanceSummary() {
  const income = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  return (
    <div>
      <GenericSummary title="Mês corrente" items={[
        { label: "Receitas", value: `R$ ${income.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` },
        { label: "Despesas", value: `R$ ${Math.abs(expense).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` },
        { label: "Saldo",    value: `R$ ${(income + expense).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` },
      ]}/>
      <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Top categorias</div>
      <div className="mt-2 space-y-2">
        {["Moradia", "Software", "Alimentação"].map((c, i) => (
          <div key={c}>
            <div className="flex justify-between text-[12.5px] text-foreground/90">
              <span>{c}</span>
              <span className="font-mono text-muted-foreground">{[3200, 701.90, 332.20][i].toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--ctp-surface0)]">
              <div className="h-full" style={{ width: `${[90, 30, 18][i]}%`, backgroundColor: ["var(--ctp-peach)", "var(--ctp-blue)", "var(--ctp-pink)"][i] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RightEmail() {
  // Show a contextual "related" panel when viewing emails folder
  const e = emails[0];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Conversa</div>
        <div className="mt-0.5 font-display text-[13px] font-semibold text-foreground truncate">{e.subject}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <Avatar name={e.from} color="ctp-pink" />
          <div>
            <div className="text-[13px] font-semibold text-foreground">{e.from}</div>
            <div className="font-mono text-[10.5px] text-muted-foreground">{e.fromEmail}</div>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">{e.preview}</p>

        <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Anexos</div>
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-[var(--ctp-base)] p-2.5 text-[12.5px]">
          <Paperclip size={13} className="text-ctp-mauve" />
          <span className="flex-1 truncate text-foreground">proposta-rebrand-v3.pdf</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">2.4 MB</span>
        </div>

        <div className="mt-6 font-display text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Threads relacionadas</div>
        <div className="mt-2 flex flex-col gap-1">
          {emails.slice(1, 4).map(m => (
            <button key={m.id} className="rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--ctp-surface0)]/60">
              <div className="truncate text-foreground">{m.subject}</div>
              <div className="truncate text-[11px] text-muted-foreground">{m.from} · {m.time}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
