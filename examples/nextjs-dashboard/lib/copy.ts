/** Final dashboard copy from the #29 spec and product answers on #112 (EN / PT-BR), verbatim. `{url}`/`{n}` via `fill`. */
export type Locale = "en" | "pt-BR";

export type Copy = {
  signInError: string;
  unreachable: string;
  retry: string;
  projectsEmptyTitle: string;
  projectsEmptyBody: string;
  createProject: string;
  snippetWaiting: string;
  snippetStill: string;
  snippetSuccess: string;
  snippetSuccessLink: string;
  pagesEmpty: string;
  changePeriod: string;
  heatmapEmpty: string;
  partial: string;
  copyDetails: string;
  copied: string;
  signIn: string;
  adminToken: string;
  continue: string;
  projects: string;
  pages: string;
  newProject: string;
  copy: string;
  skipToContent: string;
  openInNewTab: string;
  pagesEmpty24h: string;
  pasteBefore: string;
  pasteAfter: string;
  popularPages: string;
  colPage: string;
  colPath: string;
  colSessions: string;
  colClicks: string;
  colProject: string;
  receivingData: string;
  noData24h: string;
  showMore: string;
  loading: string;
};

const en: Copy = {
  signInError: "That token didn't work. Check it and try again.",
  unreachable: "Can't reach the collector at {url}. Check that it's running.",
  retry: "Retry",
  projectsEmptyTitle: "Create your first project",
  projectsEmptyBody: "You'll get a snippet to paste into your site.",
  createProject: "Create project",
  snippetWaiting: "Waiting for your first event… Open your site in another tab.",
  snippetStill: "Still nothing. Check that the snippet is on the page and that Do Not Track is off in this browser.",
  snippetSuccess: "Receiving events.",
  snippetSuccessLink: "Open your pages",
  pagesEmpty: "No visits in the last {n} days.",
  pagesEmpty24h: "No visits in the last 24 hours.",
  changePeriod: "Change period",
  heatmapEmpty: "No clicks for this screen size in this period",
  partial: "Showing a sample of the data",
  copyDetails: "Copy details",
  copied: "Copied",
  signIn: "Sign in",
  adminToken: "Admin token",
  continue: "Continue",
  projects: "Projects",
  pages: "Pages",
  newProject: "New project",
  copy: "Copy",
  skipToContent: "Skip to content",
  openInNewTab: "Open page in new tab",
  pasteBefore: "Paste this before",
  pasteAfter: "on every page you want to track.",
  popularPages: "Popular pages, by sessions",
  colPage: "Page",
  colPath: "Path",
  colSessions: "Sessions",
  colClicks: "Clicks",
  colProject: "Project",
  receivingData: "Receiving data",
  noData24h: "No data in the last 24 h",
  showMore: "Show more",
  loading: "Loading…"
};

const ptBR: Copy = {
  signInError: "Esse token não funcionou. Confira e tente de novo.",
  unreachable: "Não foi possível acessar o coletor em {url}. Confira se ele está rodando.",
  retry: "Tentar de novo",
  projectsEmptyTitle: "Crie seu primeiro projeto",
  projectsEmptyBody: "Você vai receber um snippet para colar no seu site.",
  createProject: "Criar projeto",
  snippetWaiting: "Aguardando o primeiro evento… Abra seu site em outra aba.",
  snippetStill: "Ainda nada. Confira se o snippet está na página e se o Do Not Track está desligado neste navegador.",
  snippetSuccess: "Recebendo eventos.",
  snippetSuccessLink: "Ver suas páginas",
  pagesEmpty: "Nenhuma visita nos últimos {n} dias.",
  pagesEmpty24h: "Nenhuma visita nas últimas 24 horas.",
  changePeriod: "Mudar período",
  heatmapEmpty: "Nenhum clique neste tamanho de tela no período",
  partial: "Mostrando uma amostra dos dados",
  copyDetails: "Copiar detalhes",
  copied: "Copiado",
  signIn: "Entrar",
  adminToken: "Token de admin",
  continue: "Continuar",
  projects: "Projetos",
  pages: "Páginas",
  newProject: "Novo projeto",
  copy: "Copiar",
  skipToContent: "Pular para o conteúdo",
  openInNewTab: "Abrir página em nova aba",
  pasteBefore: "Cole isto antes de",
  pasteAfter: "em todas as páginas que você quer acompanhar.",
  popularPages: "Páginas mais visitadas, por sessões",
  colPage: "Página",
  colPath: "Caminho",
  colSessions: "Sessões",
  colClicks: "Cliques",
  colProject: "Projeto",
  receivingData: "Recebendo dados",
  noData24h: "Sem dados nas últimas 24 h",
  showMore: "Mostrar mais",
  loading: "Carregando…"
};

/** Pages empty text for the selected period (1 day reads "24 hours"). */
export const pagesEmptyText = (copy: Copy, days: number) =>
  days === 1 ? copy.pagesEmpty24h : fill(copy.pagesEmpty, { n: String(days) });

export const COPY: Record<Locale, Copy> = { en, "pt-BR": ptBR };

/** PT-BR when the browser language starts with `pt`, otherwise EN. */
export const pickLocale = (language: string | undefined): Locale =>
  language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";

export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
