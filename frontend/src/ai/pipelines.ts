/**
 * Deciding which automation results a question actually needs.
 *
 * The assistant could fetch all four modules before every message, but each one
 * costs the backend a round of `includeData` fetches against n8n. So the
 * question is read first: "¿qué ofertas hay?" pulls Laboral, "¿qué ha hecho hoy
 * mi asistente?" pulls everything with a small limit, and "hola" pulls nothing.
 *
 * The backend has already projected and truncated whatever comes back
 * (`services/pipelines.py`); this module only picks the modules, lifts a search
 * term when the question contains one, and renders the result as plain text for
 * the context block.
 */
import { pipelinesApi } from "@/api";
import type { PipelineResult } from "@/api/types";

export type PipelineModule = "correos" | "laboral" | "noticias" | "marca-personal";

/** Words that point at one module, accent-insensitive and stemmed by hand. */
const TRIGGERS: Record<PipelineModule, string[]> = {
  correos: ["correo", "correos", "email", "emails", "mail", "bandeja", "inbox", "mensaje"],
  laboral: ["oferta", "ofertas", "laboral", "empleo", "trabajo", "puesto", "vacante", "job", "jobs"],
  noticias: ["noticia", "noticias", "news", "articulo", "articulos", "prensa", "actualidad"],
  "marca-personal": ["marca", "linkedin", "borrador", "borradores", "publicacion", "publicaciones", "post"],
};

/** Questions about the day as a whole: everything, but shallow. */
const BROAD = [
  "que ha hecho",
  "que has hecho",
  "que ha pasado",
  "resumen",
  "resume",
  "hoy",
  "ayer",
  "esta semana",
  "novedades",
  "ultimas",
  "cambios",
];

/**
 * Phrases that introduce a topic: "noticias sobre IA", "noticias de inteligencia
 * artificial", "qué ha pasado con la IA". The bare "de" is included because it
 * is how the question is usually asked, and `NOT_A_TOPIC` below keeps it from
 * turning "correos de ayer" into a search for "ayer".
 */
const TOPIC =
  /\b(sobre|acerca de|relacionad[oa]s? con|que hablen de|de tema|con la|con el|de la|del|de)\s+([^?.,;]{2,40})/i;

/** What follows "de"/"con" when it names a period or the assistant, not a topic. */
const NOT_A_TOPIC = [
  "hoy",
  "ayer",
  "esta semana",
  "la semana",
  "este mes",
  "ahora",
  "mi asistente",
  "el asistente",
  "trabajo",
  "empleo",
  "marca personal",
  "linkedin",
];

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export interface PipelineRequest {
  modules: PipelineModule[];
  /** Search term lifted from the question, if any. */
  query: string;
  /** True when the question was broad, so each module is sampled shallowly. */
  broad: boolean;
}

/** What, if anything, this question needs from the automations. */
export function planLookup(question: string): PipelineRequest {
  const text = normalise(question);
  const modules = (Object.keys(TRIGGERS) as PipelineModule[]).filter((key) =>
    TRIGGERS[key].some((word) => text.includes(word)),
  );

  const broad = modules.length === 0 && BROAD.some((phrase) => text.includes(phrase));
  const topic = TOPIC.exec(question);

  let query = "";
  if (modules.length === 1 && topic) {
    const candidate = topic[2].trim().replace(/\s+(que|los|las|el|la)$/i, "");
    const normalised = normalise(candidate);
    const temporal = NOT_A_TOPIC.some((word) => normalised.startsWith(word));
    if (!temporal && candidate.length >= 2) query = candidate;
  }

  return {
    modules: modules.length ? modules : broad ? (Object.keys(TRIGGERS) as PipelineModule[]) : [],
    query,
    broad,
  };
}

/** Render one module's result for the context block. */
export function renderModule(result: PipelineResult): string {
  const head = `${result.label.toUpperCase()} (${result.count} elemento${result.count === 1 ? "" : "s"}${
    result.latest_run_at ? `, última ejecución ${result.latest_run_at}` : ""
  })`;

  if (result.count === 0) {
    return `${head}\n- sin datos: ${result.detail || "no hay resultados"}`;
  }

  // When nothing matched the term, the backend returns the most recent items
  // instead of nothing. Say so, or the model concludes "no hay noticias" and
  // offers to run the workflow while real results sit right under its nose.
  const ranking = result.query
    ? result.relaxed
      ? `  NOTA: ninguna entrada menciona «${result.query}» de forma literal. Las de arriba son ` +
        "resultados reales y recientes: decide tú cuáles tratan el tema y responde con ellas. " +
        "No digas que no hay resultados, y no propongas ejecutar el workflow."
      : `  (${result.matched} coincidencia(s) con «${result.query}», ordenadas por relevancia)`
    : "";

  const lines = result.items.map((item) => {
    const parts = Object.entries(item)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => `${key}: ${String(value)}`);
    return `- ${parts.join(" | ")}`;
  });

  const notes = [ranking, result.privacy_note ? `  (${result.privacy_note})` : ""].filter(Boolean);
  return [head, ...lines, ...notes].join("\n");
}

export interface LookupOutcome {
  /** Text appended to the system context, empty when nothing was fetched. */
  context: string;
  /** Modules actually consulted, for the "sources" line under the answer. */
  sources: { module: string; label: string; count: number }[];
  failed: string[];
}

/**
 * Fetch what the question needs. Failures are collected rather than thrown: a
 * module that cannot be read must not stop the assistant from answering with
 * the rest, and the reply says which one was missing.
 */
export async function lookup(
  plan: PipelineRequest,
  signal?: AbortSignal,
): Promise<LookupOutcome> {
  if (plan.modules.length === 0) return { context: "", sources: [], failed: [] };

  const limit = plan.broad ? 5 : 10;
  const scan = plan.broad ? 2 : 4;

  const settled = await Promise.allSettled(
    plan.modules.map((module) =>
      pipelinesApi.get(module, { limit, scan, q: plan.query || undefined }, signal),
    ),
  );

  const blocks: string[] = [];
  const sources: LookupOutcome["sources"] = [];
  const failed: string[] = [];

  settled.forEach((outcome, index) => {
    const module = plan.modules[index];
    if (outcome.status === "fulfilled") {
      blocks.push(renderModule(outcome.value));
      sources.push({ module, label: outcome.value.label, count: outcome.value.count });
    } else {
      failed.push(module);
    }
  });

  if (failed.length) {
    blocks.push(
      `MÓDULOS NO DISPONIBLES EN ESTA CONSULTA: ${failed.join(", ")} - dilo claramente en la respuesta.`,
    );
  }

  return {
    context: blocks.length
      ? [
          "RESULTADOS REALES DE LAS AUTOMATIZACIONES",
          "Extraídos ahora mismo de las ejecuciones de n8n. Úsalos para responder; no inventes nada",
          "que no esté aquí, y si un módulo no tiene datos, dilo.",
          "",
          ...blocks,
        ].join("\n")
      : "",
    sources,
    failed,
  };
}
