// Mock data for the productivity workspace

export type ModuleId =
  | "contacts"
  | "agenda"
  | "calendar"
  | "notes"
  | "emails"
  | "finance"
  | "projects";

export interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  avatarColor: string;
  tags: string[];
  notes: string;
}

export interface Task {
  id: string;
  title: string;
  bucket: "inbox" | "today" | "soon";
  done: boolean;
  due?: string;
  project?: string;
}

export interface CalEvent {
  id: string;
  title: string;
  time: string;
  endTime: string;
  location?: string;
  color: string;
  attendees?: string[];
}

export interface Note {
  id: string;
  title: string;
  preview: string;
  updated: string;
  tags: string[];
  body: string;
  backlinks: string[];
}

export interface Email {
  id: string;
  folder: "inbox" | "sent" | "starred" | "spam" | "trash";
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  time: string;
  unread: boolean;
  starred: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "investment";
  balance: number;
  currency: string;
  color: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  account: string;
}

export interface Project {
  id: string;
  name: string;
  status: "active" | "on-hold" | "done";
  progress: number;
  color: string;
  description: string;
  due: string;
  team: string[];
  columns: { id: string; title: string; cards: { id: string; title: string; tag?: string }[] }[];
}

export const contacts: Contact[] = [
  { id: "c1", name: "Ana Beatriz Costa", role: "Product Designer", company: "Nimbus Labs", email: "ana@nimbus.io", phone: "+55 11 9 8123-4567", avatarColor: "ctp-pink", tags: ["design", "nimbus"], notes: "Conheci no evento de UX em São Paulo. Trabalhamos juntos no rebrand." },
  { id: "c2", name: "Bruno Almeida", role: "Engineering Lead", company: "Forge Studio", email: "bruno@forge.dev", phone: "+55 21 9 9123-2211", avatarColor: "ctp-blue", tags: ["eng", "forge"], notes: "Referência em arquitetura distribuída." },
  { id: "c3", name: "Camila Ribeiro", role: "Founder", company: "Talo", email: "camila@talo.app", phone: "+55 31 9 8888-1010", avatarColor: "ctp-mauve", tags: ["founder"], notes: "Investidora-anjo, interessada em produtividade." },
  { id: "c4", name: "Diego Fernández", role: "Marketing", company: "Orbit", email: "diego@orbit.cl", phone: "+56 9 5544-2200", avatarColor: "ctp-peach", tags: ["marketing"], notes: "Parceria de conteúdo Q3." },
  { id: "c5", name: "Elena Marchetti", role: "Researcher", company: "Università di Bologna", email: "elena@unibo.it", phone: "+39 051 209-9999", avatarColor: "ctp-green", tags: ["academia"], notes: "Pesquisa de hábitos digitais." },
  { id: "c6", name: "Felipe Tanaka", role: "iOS Engineer", company: "Independente", email: "felipe@tanaka.dev", phone: "+55 11 9 7777-3322", avatarColor: "ctp-teal", tags: ["eng", "freela"], notes: "Disponível para freelas a partir de outubro." },
  { id: "c7", name: "Gabriela Souza", role: "Operations", company: "Talo", email: "gabriela@talo.app", phone: "+55 11 9 6655-7788", avatarColor: "ctp-yellow", tags: ["ops"], notes: "Ponto focal para faturamento." },
  { id: "c8", name: "Henrique Vidal", role: "Advogado", company: "Vidal & Co.", email: "henrique@vidalco.com", phone: "+55 11 9 4422-9090", avatarColor: "ctp-lavender", tags: ["legal"], notes: "Revisão de contratos de SaaS." },
];

export const tasks: Task[] = [
  { id: "t1", title: "Revisar proposta da Nimbus", bucket: "today", done: false, due: "Hoje, 14:00", project: "Rebrand" },
  { id: "t2", title: "Responder Bruno sobre arquitetura", bucket: "today", done: false, due: "Hoje", project: "Forge" },
  { id: "t3", title: "Publicar release notes 2.4", bucket: "today", done: true, due: "Hoje", project: "Lumen" },
  { id: "t4", title: "Reunião 1:1 com Gabriela", bucket: "soon", done: false, due: "Qua, 10:00" },
  { id: "t5", title: "Fechar fluxo de cobrança recorrente", bucket: "soon", done: false, due: "Sex", project: "Lumen" },
  { id: "t6", title: "Ler artigo da Elena sobre hábitos", bucket: "soon", done: false, due: "Próx. semana" },
  { id: "t7", title: "Atualizar wiki do time", bucket: "inbox", done: false },
  { id: "t8", title: "Comprar webcam nova", bucket: "inbox", done: false },
  { id: "t9", title: "Rever orçamento de junho", bucket: "inbox", done: false },
  { id: "t10", title: "Pedir feedback do onboarding", bucket: "inbox", done: false },
];

export const events: CalEvent[] = [
  { id: "e1", title: "Daily — Time Lumen", time: "09:30", endTime: "09:45", color: "ctp-blue", attendees: ["AB", "BA", "GS"] },
  { id: "e2", title: "1:1 com Camila", time: "11:00", endTime: "11:30", location: "Google Meet", color: "ctp-mauve", attendees: ["CR"] },
  { id: "e3", title: "Workshop de Produto", time: "14:00", endTime: "15:30", location: "Sala Helsinki", color: "ctp-peach", attendees: ["AB", "DF", "FT"] },
  { id: "e4", title: "Almoço com Bruno", time: "12:30", endTime: "13:30", location: "Pici, Pinheiros", color: "ctp-green" },
  { id: "e5", title: "Revisão de Sprint", time: "16:00", endTime: "17:00", color: "ctp-teal", attendees: ["AB", "BA", "FT", "GS"] },
  { id: "e6", title: "Pomodoro — Roadmap Q4", time: "17:30", endTime: "18:30", color: "ctp-pink" },
];

export const notes: Note[] = [
  {
    id: "n1",
    title: "Princípios de Produto",
    preview: "Um produto bem desenhado é invisível até o momento certo. Foco em fricção, ritmo e confiança…",
    updated: "há 2h",
    tags: ["produto", "manifesto"],
    body: `# Princípios de Produto\n\nUm produto bem desenhado é invisível até o momento certo.\n\n## Os três pilares\n\n1. **Fricção** — cada clique a mais é uma decisão a mais. Reduza, mas nunca às custas de clareza.\n2. **Ritmo** — bons produtos têm um pulso. Animações curtas, transições firmes, latência abaixo de 100ms.\n3. **Confiança** — o usuário precisa saber onde está, o que aconteceu, e como voltar atrás.\n\n## Referências\n\nVeja também [[Obsidian como modelo]] e [[Notas sobre Linear]].`,
    backlinks: ["Obsidian como modelo", "Notas sobre Linear", "Briefing Lumen v2"],
  },
  { id: "n2", title: "Obsidian como modelo", preview: "Por que o Obsidian funciona: keyboard-first, panels redimensionáveis, e o grafo…", updated: "ontem", tags: ["referência"], body: "# Obsidian como modelo\n\nKeyboard-first. Painéis redimensionáveis. Linkagem bidirecional.", backlinks: ["Princípios de Produto"] },
  { id: "n3", title: "Briefing Lumen v2", preview: "Workspace unificado para contatos, agenda, calendário, notas, emails…", updated: "2 dias", tags: ["lumen"], body: "# Briefing Lumen v2\n\nWorkspace unificado.", backlinks: ["Princípios de Produto"] },
  { id: "n4", title: "Notas sobre Linear", preview: "O que aprendi olhando o Linear de perto. Comandos, atalhos, densidade visual…", updated: "3 dias", tags: ["referência"], body: "# Notas sobre Linear\n\nComandos, atalhos, densidade.", backlinks: ["Princípios de Produto"] },
  { id: "n5", title: "Reunião — Camila (jun/26)", preview: "Pontos discutidos sobre investimento seed. Próximos passos: term sheet…", updated: "4 dias", tags: ["reuniões"], body: "# Reunião com Camila\n\nInvestimento, term sheet, milestones.", backlinks: [] },
  { id: "n6", title: "Ideias soltas", preview: "Capturas rápidas. Tag system inspirado em Bear. Painel de revisão semanal…", updated: "1 sem", tags: ["inbox"], body: "# Ideias soltas\n\n- Sistema de tags\n- Revisão semanal\n- Modo foco", backlinks: [] },
];

export const emails: Email[] = [
  { id: "m1", folder: "inbox", from: "Ana Beatriz Costa", fromEmail: "ana@nimbus.io", subject: "Proposta de rebrand — v3", preview: "Oi! Anexei a terceira versão da proposta com os ajustes que conversamos…", body: "Oi!\n\nAnexei a terceira versão da proposta com os ajustes que conversamos na última reunião. Os principais pontos:\n\n• Nova grade tipográfica com Plus Jakarta para títulos\n• Paleta reduzida para 6 cores principais\n• Sistema de ícones unificado\n\nMe avisa o que acha quando puder dar uma olhada.\n\nAbraço,\nAna", time: "08:42", unread: true, starred: true },
  { id: "m2", folder: "inbox", from: "Bruno Almeida", fromEmail: "bruno@forge.dev", subject: "Re: Arquitetura — sincronização offline", preview: "Sobre o que perguntou ontem: a melhor abordagem para sync offline depende muito…", body: "Sobre o que perguntou ontem: a melhor abordagem para sync offline depende muito do shape dos dados.", time: "07:55", unread: true, starred: false },
  { id: "m3", folder: "inbox", from: "Stripe", fromEmail: "no-reply@stripe.com", subject: "Pagamento recebido — R$ 2.450,00", preview: "Você recebeu um pagamento de Talo Apps Ltda…", body: "Pagamento recebido.", time: "ontem", unread: false, starred: false },
  { id: "m4", folder: "inbox", from: "Camila Ribeiro", fromEmail: "camila@talo.app", subject: "Term sheet — para revisão", preview: "Segue a primeira versão do term sheet, conforme conversamos…", body: "Segue o term sheet.", time: "ontem", unread: false, starred: true },
  { id: "m5", folder: "inbox", from: "GitHub", fromEmail: "noreply@github.com", subject: "[lumen/app] PR #284 aprovado", preview: "Felipe Tanaka aprovou seu pull request…", body: "PR aprovado.", time: "2d", unread: false, starred: false },
  { id: "m6", folder: "inbox", from: "Elena Marchetti", fromEmail: "elena@unibo.it", subject: "Convite — paper de hábitos digitais", preview: "Olá! Gostaria de te convidar para colaborar num paper…", body: "Olá!", time: "3d", unread: false, starred: false },
];

export const accounts: Account[] = [
  { id: "a1", name: "Conta Corrente — Nubank", type: "checking", balance: 18420.55, currency: "BRL", color: "ctp-mauve" },
  { id: "a2", name: "Poupança — Itaú", type: "savings", balance: 42180.00, currency: "BRL", color: "ctp-green" },
  { id: "a3", name: "Cartão de Crédito — Inter", type: "credit", balance: -3204.18, currency: "BRL", color: "ctp-peach" },
  { id: "a4", name: "Carteira Cripto", type: "investment", balance: 11890.40, currency: "BRL", color: "ctp-yellow" },
];

export const transactions: Transaction[] = [
  { id: "x1", date: "08/06", description: "Recebimento — Talo Apps", category: "Receita", amount: 2450.00, account: "Nubank" },
  { id: "x2", date: "07/06", description: "Mercado — Hortifruti", category: "Alimentação", amount: -184.20, account: "Inter" },
  { id: "x3", date: "07/06", description: "Figma — assinatura anual", category: "Software", amount: -680.00, account: "Inter" },
  { id: "x4", date: "06/06", description: "Uber", category: "Transporte", amount: -32.40, account: "Inter" },
  { id: "x5", date: "05/06", description: "Aluguel — junho", category: "Moradia", amount: -3200.00, account: "Nubank" },
  { id: "x6", date: "04/06", description: "Restaurante Pici", category: "Alimentação", amount: -148.00, account: "Inter" },
  { id: "x7", date: "03/06", description: "Transferência para poupança", category: "Investimento", amount: -2000.00, account: "Nubank" },
  { id: "x8", date: "02/06", description: "Salário — Forge Studio", category: "Receita", amount: 12500.00, account: "Nubank" },
  { id: "x9", date: "01/06", description: "Spotify", category: "Software", amount: -21.90, account: "Inter" },
];

export const projects: Project[] = [
  {
    id: "p1",
    name: "Lumen 2.5",
    status: "active",
    progress: 64,
    color: "ctp-mauve",
    description: "Release com sincronização offline, atalhos globais e novo módulo financeiro.",
    due: "30 de junho",
    team: ["AB", "BA", "FT", "GS"],
    columns: [
      { id: "todo", title: "A fazer", cards: [
        { id: "k1", title: "Especificar sync offline", tag: "spec" },
        { id: "k2", title: "Atalhos globais ⌘K", tag: "ux" },
        { id: "k3", title: "Importador de CSV", tag: "finanças" },
      ]},
      { id: "doing", title: "Em progresso", cards: [
        { id: "k4", title: "Refatorar painel direito", tag: "front" },
        { id: "k5", title: "Migração para tokens v2", tag: "design" },
      ]},
      { id: "review", title: "Revisão", cards: [
        { id: "k6", title: "Onboarding em 3 passos", tag: "ux" },
      ]},
      { id: "done", title: "Concluído", cards: [
        { id: "k7", title: "Tema Catppuccin", tag: "design" },
        { id: "k8", title: "Tipografia Plus Jakarta", tag: "design" },
      ]},
    ],
  },
  { id: "p2", name: "Rebrand Nimbus", status: "active", progress: 38, color: "ctp-pink", description: "Identidade visual completa para Nimbus Labs.", due: "15 de julho", team: ["AB", "GS"], columns: [
    { id: "todo", title: "A fazer", cards: [{ id: "r1", title: "Moodboard final" }, { id: "r2", title: "Logo — 3 direções" }] },
    { id: "doing", title: "Em progresso", cards: [{ id: "r3", title: "Sistema tipográfico" }] },
    { id: "review", title: "Revisão", cards: [] },
    { id: "done", title: "Concluído", cards: [{ id: "r4", title: "Briefing aprovado" }] },
  ]},
  { id: "p3", name: "Paper — Hábitos Digitais", status: "on-hold", progress: 12, color: "ctp-green", description: "Colaboração com Elena Marchetti (Unibo).", due: "Setembro", team: ["EM"], columns: [
    { id: "todo", title: "A fazer", cards: [{ id: "h1", title: "Revisar bibliografia" }] },
    { id: "doing", title: "Em progresso", cards: [] },
    { id: "review", title: "Revisão", cards: [] },
    { id: "done", title: "Concluído", cards: [] },
  ]},
  { id: "p4", name: "Site institucional", status: "done", progress: 100, color: "ctp-teal", description: "Landing page e blog.", due: "Concluído", team: ["AB", "DF"], columns: [
    { id: "todo", title: "A fazer", cards: [] },
    { id: "doing", title: "Em progresso", cards: [] },
    { id: "review", title: "Revisão", cards: [] },
    { id: "done", title: "Concluído", cards: [{ id: "s1", title: "Deploy" }, { id: "s2", title: "SEO" }] },
  ]},
];
