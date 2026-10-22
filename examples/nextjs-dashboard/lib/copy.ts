/**
 * Final dashboard copy from the #29 spec (EN / PT-BR), verbatim. `{url}` and `{n}` are filled by `fill`.
 * Strings the spec gives only in English (nav, field labels, buttons outside the table) stay English in both.
 */
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
  pagesEmpty: "No visits in the last 7 days.",
  changePeriod: "Change period",
  heatmapEmpty: "No clicks for this screen size in this period",
  partial: "Showing a sample of {n} visits",
  copyDetails: "Copy details",
  copied: "Copied"
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
  pagesEmpty: "Nenhuma visita nos últimos 7 dias.",
  changePeriod: "Mudar período",
  heatmapEmpty: "Nenhum clique neste tamanho de tela no período",
  partial: "Mostrando uma amostra de {n} visitas",
  copyDetails: "Copiar detalhes",
  copied: "Copiado"
};

export const COPY: Record<Locale, Copy> = { en, "pt-BR": ptBR };

/** PT-BR when the browser language starts with `pt`, otherwise EN. */
export const pickLocale = (language: string | undefined): Locale =>
  language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";

export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
