import { describe, expect, it } from "vitest";
import { extractInsight, sanitiseInsight } from "./insight";
import { n8nStateOf } from "@/hooks/queries";
import type { AiGenerateResponse } from "@/api/types";

/**
 * Two defects found against the real installation:
 *
 *  - the dashboard printed Nemotron's chain of thought as the AI insight;
 *  - Automations said "n8n connected" directly above an HTTP 401.
 *
 * Both are about reporting what is *usable*, not what merely came back.
 */

function response(over: Partial<AiGenerateResponse> = {}): AiGenerateResponse {
  return {
    text: "",
    data: null,
    provider: "nvidia_nim",
    model: "nvidia/nemotron-3-super-120b-a12b",
    latency_ms: 900,
    finish_reason: "stop",
    usage: {},
    used_fallback: false,
    primary_provider: "",
    primary_error: "",
    ...over,
  };
}

describe("extractInsight", () => {
  it("prefers the RESUMEN line the prompt asks for", () => {
    const raw =
      "We need to answer in at most two sentences, no markdown. The context shows no executions.\n\n" +
      "RESUMEN: Tu asistente no ha ejecutado ninguna automatización hoy y n8n rechaza la API key.";
    const result = extractInsight(response({ text: raw }));
    expect(result.source).toBe("sentinel");
    expect(result.text).toBe(
      "Tu asistente no ha ejecutado ninguna automatización hoy y n8n rechaza la API key.",
    );
  });

  it("uses a structured field when the backend parsed one", () => {
    const result = extractInsight(
      response({
        data: { insight: "Tu asistente no ha ejecutado nada hoy; n8n rechaza la API key." },
        // the raw reply still carries the thinking that preceded the JSON
        text: 'We need two sentences. {"insight": "Tu asistente no ha ejecutado nada hoy; n8n rechaza la API key."}',
      }),
    );
    expect(result.source).toBe("structured");
    expect(result.text).toBe("Tu asistente no ha ejecutado nada hoy; n8n rechaza la API key.");
  });

  it("passes an ordinary answer through untouched", () => {
    const text = "Tu automatización Laboral procesó 312 ofertas esta mañana y seleccionó 18.";
    expect(extractInsight(response({ text }))).toEqual({ text, source: "text" });
  });

  it("never shows reasoning when nothing usable survives", () => {
    // the exact shape observed against the live provider
    const raw =
      "We need to answer in at most two sentences, no greeting, no markdown. We should mention " +
      "that the user wants concrete facts. Let's output that.";
    const result = extractInsight(response({ text: raw, finish_reason: "length" }));
    expect(result.text).toBe("");
    expect(result.source).toBe("none");
  });

  it("recovers the answer the model quoted to itself", () => {
    const raw =
      'We need two sentences, no markdown. So the summary is: "Tu asistente no ha ejecutado ninguna ' +
      'automatización y el servicio n8n necesita atención." That\'s two sentences.';
    const result = extractInsight(response({ text: raw }));
    expect(result.source).toBe("recovered");
    expect(result.text).toBe(
      "Tu asistente no ha ejecutado ninguna automatización y el servicio n8n necesita atención.",
    );
  });

  it("strips a think block without touching the answer after it", () => {
    const raw = "<think>the user wants two sentences, let's write them</think>\nTodo funciona con normalidad.";
    expect(sanitiseInsight(raw)).toEqual({ text: "Todo funciona con normalidad.", source: "text" });
  });

  it("drops an unterminated think block", () => {
    expect(sanitiseInsight("<think>we need to decide how to phrase").text).toBe("");
  });
});

describe("n8nStateOf", () => {
  it("reports a rejected key as invalid even when the port answers", () => {
    // exactly what the real backend returns for a reachable n8n with a bad key
    expect(
      n8nStateOf({
        base_url: "http://n8n:5678",
        api_key_configured: true,
        status: "online",
        reachable: true,
        api_key_valid: false,
      }),
    ).toBe("invalid");
  });

  it("still reports a healthy instance as online", () => {
    expect(
      n8nStateOf({
        base_url: "http://n8n:5678",
        api_key_configured: true,
        status: "online",
        reachable: true,
        api_key_valid: true,
      }),
    ).toBe("online");
  });

  it("keeps not-configured distinct from an outage", () => {
    expect(
      n8nStateOf({ base_url: "", api_key_configured: false, status: "not_configured" }),
    ).toBe("not_configured");
    expect(n8nStateOf(undefined, true)).toBe("offline");
    expect(n8nStateOf(undefined)).toBe("unknown");
  });
});
