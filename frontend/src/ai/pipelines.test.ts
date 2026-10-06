import { describe, expect, it } from "vitest";
import { planLookup, renderModule } from "./pipelines";
import type { PipelineResult } from "@/api/types";

/**
 * Which modules a question needs, and how their results read in the context.
 *
 * The cost of getting this wrong is concrete: every module in the plan makes
 * the backend pull several full executions out of n8n, so "hola" must fetch
 * nothing and "¿qué ofertas hay?" must fetch Laboral alone.
 */

function result(over: Partial<PipelineResult> = {}): PipelineResult {
  return {
    module: "noticias",
    label: "Noticias",
    description: "",
    privacy_note: "",
    workflow: { id: "w", name: "Asistente - Noticias" },
    items: [],
    count: 0,
    available: 0,
    query: "",
    matched: 0,
    relaxed: false,
    executions_inspected: 1,
    latest_run_at: null,
    source_nodes: [],
    detail: "",
    cached: false,
    ...over,
  };
}

describe("planLookup", () => {
  it("asks for nothing when the question is not about results", () => {
    expect(planLookup("hola").modules).toEqual([]);
    expect(planLookup("¿está funcionando n8n?").modules).toEqual([]);
  });

  it("picks the single module a question names", () => {
    expect(planLookup("¿qué ofertas laborales hay esta semana?").modules).toEqual(["laboral"]);
    expect(planLookup("¿cuáles son las últimas noticias?").modules).toEqual(["noticias"]);
    expect(planLookup("resume los últimos correos relevantes").modules).toEqual(["correos"]);
    expect(planLookup("¿qué ha encontrado el workflow de marca personal?").modules).toEqual([
      "marca-personal",
    ]);
  });

  it("works without accents and regardless of case", () => {
    expect(planLookup("QUE NOTICIAS han salido?").modules).toEqual(["noticias"]);
    expect(planLookup("ultimas publicaciones de linkedin").modules).toEqual(["marca-personal"]);
  });

  it("samples every module for a broad question about the day", () => {
    const plan = planLookup("¿qué ha hecho hoy mi asistente?");
    expect(plan.broad).toBe(true);
    expect(plan.modules).toHaveLength(4);
  });

  it("lifts the topic when the question narrows one module", () => {
    expect(planLookup("¿qué noticias hay sobre inteligencia artificial?").query).toBe(
      "inteligencia artificial",
    );
    expect(planLookup("ofertas relacionadas con Python").query).toBe("Python");
    // two modules at once: a single search term would be wrong for both
    expect(planLookup("noticias y ofertas sobre IA").query).toBe("");
  });

  it("reads the plain forms the user actually types", () => {
    // the exact question that failed in production
    const plan = planLookup("¿Cuáles son las últimas noticias sobre inteligencia artificial?");
    expect(plan.modules).toEqual(["noticias"]);
    expect(plan.query.toLowerCase()).toBe("inteligencia artificial");

    expect(planLookup("últimas noticias de inteligencia artificial").query.toLowerCase()).toBe(
      "inteligencia artificial",
    );
    expect(planLookup("¿qué noticias hablan de IA?").query).toBe("IA");
  });

  it("does not turn a time reference into a search term", () => {
    expect(planLookup("¿qué correos he recibido hoy?").query).toBe("");
    expect(planLookup("noticias de hoy").query).toBe("");
    expect(planLookup("ofertas de esta semana").query).toBe("");
  });
});

describe("renderModule", () => {
  it("lists the real fields and hides internal ones", () => {
    const text = renderModule(
      result({
        module: "laboral",
        label: "Laboral",
        count: 1,
        latest_run_at: "2026-09-12T07:30:00+00:00",
        items: [
          {
            title: "Data Engineer",
            company: "Acme",
            score: 87,
            _execution_id: "257",
            _run_at: "2026-09-12T07:30:00+00:00",
          },
        ],
      }),
    );

    expect(text).toContain("LABORAL (1 elemento");
    expect(text).toContain("title: Data Engineer");
    expect(text).toContain("score: 87");
    expect(text).not.toContain("_execution_id");
  });

  it("warns that the filter was relaxed, so the model does not claim there is nothing", () => {
    const text = renderModule(
      result({
        count: 2,
        available: 2,
        query: "IA",
        matched: 0,
        relaxed: true,
        items: [{ titulo: "Europa frente a EE.UU." }, { titulo: "Mercado inmobiliario" }],
        detail: "ninguna entrada menciona «IA» de forma literal",
      }),
    );

    expect(text).toContain("resultados reales y recientes");
    expect(text).toContain("no propongas ejecutar el workflow");
    expect(text).toContain("Europa frente a EE.UU.");
  });

  it("states how many items matched when the filter did work", () => {
    const text = renderModule(
      result({ count: 1, query: "IA", matched: 1, items: [{ titulo: "Modelos de IA" }] }),
    );
    expect(text).toContain("1 coincidencia(s) con «IA»");
    expect(text).not.toContain("no propongas");
  });

  it("says why a module is empty instead of leaving a blank", () => {
    const text = renderModule(result({ detail: "el workflow no ha producido nada" }));
    expect(text).toContain("sin datos: el workflow no ha producido nada");
  });

  it("carries the privacy note so the model does not ask for more", () => {
    const text = renderModule(
      result({
        module: "correos",
        label: "Correos",
        count: 1,
        items: [{ From: "a@b.com", Subject: "Factura" }],
        privacy_note: "Solo remitente, asunto y fecha.",
      }),
    );
    expect(text).toContain("Solo remitente, asunto y fecha.");
    expect(text).toContain("Subject: Factura");
  });
});
