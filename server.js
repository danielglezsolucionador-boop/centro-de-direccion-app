const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ quiet: true });

const app = express();
app.use(express.static("public"));
app.use(express.json({ limit: "256kb" }));

const DATA_DIR = path.join(__dirname, "data");
const LEGACY_MEMORY_FILE = path.join(__dirname, "memoria.json");
const LEGACY_RESULTS_FILE = path.join(__dirname, "resultados.json");
const MEMORY_FILE = path.join(DATA_DIR, "memoria.json");
const RESULTS_FILE = path.join(DATA_DIR, "resultados.json");
const DECISION_TRACE_FILE = path.join(DATA_DIR, "decision_traces.json");
const OPERATIONAL_MEMORY_FILE = path.join(DATA_DIR, "operational_memory.json");

const PROVIDER_CONFIG = {
  anthropic: {
    provider_id: "anthropic",
    provider_name: "Anthropic",
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    credential_env: "ANTHROPIC_API_KEY",
    model: process.env.CEREBRO_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
  },
};

ensureDataFiles();

const AGENTES = {
  ventas: {
    nombre: "Ventas",
    prompt: `Eres el agente de VENTAS. Evalua dinero, conversion y leads reales.
Critica todo lo que no genere ingresos directos o validacion comercial.
Maximo 3 oraciones.
Formato: {"critica":"...","impacto_ventas":"alto/medio/bajo","sugerencia":"..."}`,
  },
  marketing: {
    nombre: "Marketing",
    prompt: `Eres el agente de MARKETING. Evalua visibilidad, alcance y posicionamiento.
Maximo 3 oraciones.
Formato: {"critica":"...","impacto_marketing":"alto/medio/bajo","sugerencia":"..."}`,
  },
  finanzas: {
    nombre: "Finanzas",
    prompt: `Eres el agente de FINANZAS. Cortas gastos inutiles y mides ROI real.
No apruebas nada sin impacto economico razonable.
Maximo 3 oraciones.
Formato: {"critica":"...","roi_estimado":"alto/medio/bajo/negativo","sugerencia":"..."}`,
  },
  producto: {
    nombre: "Producto",
    prompt: `Eres el agente de PRODUCTO. Evalua viabilidad tecnica, complejidad y tiempo.
Detectas si algo es construible rapido o es una trampa operacional.
Maximo 3 oraciones.
Formato: {"critica":"...","viabilidad":"alta/media/baja","sugerencia":"..."}`,
  },
  investigador: {
    nombre: "Investigador IA",
    prompt: `Eres el agente INVESTIGADOR de IA. Traes oportunidades aplicables ahora.
Maximo 3 oraciones.
Formato: {"critica":"...","oportunidad":"...","sugerencia":"..."}`,
  },
};

const CEREBRO_PROMPT = `Eres CEREBRO, sistema ejecutivo operacional.
Recibes debate de agentes y decides con criterios de rentabilidad, velocidad, facilidad, riesgo y trazabilidad.

REGLAS:
- Maximo 3 acciones concretas.
- Si algo no mejora ingresos, estabilidad o claridad, degradalo.
- No apruebes acciones irreversibles sin aprobacion humana.
- Responde en JSON.

FORMATO:
{
  "decision": "aprobado/rechazado/modificado",
  "razon": "1-2 lineas",
  "prioridades": ["accion 1", "accion 2", "accion 3"],
  "descartado": ["que se descarta y por que"],
  "plazo": "X dias",
  "mensaje_final": "directo al CEO"
}`;

const APRENDIZAJE_PROMPT = `Eres el motor de aprendizaje de CEREBRO.
Analiza resultados registrados y genera insights accionables.
No cambies reglas base sin aprobacion.

FORMATO:
{
  "patrones": ["patron 1"],
  "aciertos": ["que funciono"],
  "fallos": ["que no funciono"],
  "insights": ["insight accionable"],
  "ajuste_recomendado": "ajuste reversible",
  "requiere_aprobacion": false
}`;

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  migrateIfNeeded(LEGACY_MEMORY_FILE, MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  migrateIfNeeded(LEGACY_RESULTS_FILE, RESULTS_FILE, { registros: [] });
  ensureJsonFile(DECISION_TRACE_FILE, { traces: [] });
  ensureJsonFile(OPERATIONAL_MEMORY_FILE, { events: [] });
}

function migrateIfNeeded(legacyPath, targetPath, fallback) {
  if (!fs.existsSync(targetPath) && fs.existsSync(legacyPath)) {
    fs.copyFileSync(legacyPath, targetPath);
  }
  ensureJsonFile(targetPath, fallback);
}

function ensureJsonFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  }
}

function leerJSON(file, defecto) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return defecto;
  }
  return defecto;
}

function guardarJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyAction(input = {}) {
  const text = normalizeText([
    input.action,
    input.propuesta,
    input.contexto,
    input.notas,
    input.accion,
  ].join(" "));

  const blockedTerms = [
    "exponer secret",
    "mostrar api key",
    "subir .env",
    "borrar memoria",
    "destruir memoria",
    "eliminar logs",
    "bypass governance",
    "sin aprobacion",
  ];
  const approvalTerms = [
    "eliminar sistema",
    "borrar sistema",
    "destruir",
    "cierre definitivo",
    "cambio irreversible",
    "cambio seguridad profunda",
    "produccion",
    "deploy",
    "gasto importante",
    "migrar base",
    "overwrite",
    "sobrescribir",
  ];

  const matchedBlocked = blockedTerms.filter((term) => text.includes(term));
  const matchedApproval = approvalTerms.filter((term) => text.includes(term));

  if (matchedBlocked.length) {
    return {
      status: "blocked",
      risk_level: "critical",
      reversibility: "unsafe",
      approval_required: true,
      reason: `Blocked by governance: ${matchedBlocked.join(", ")}`,
      matched_terms: matchedBlocked,
      response_target: input.response_target || input.actor || "CEO",
    };
  }

  if (matchedApproval.length) {
    return {
      status: "approval_required",
      risk_level: "high",
      reversibility: "irreversible_or_sensitive",
      approval_required: true,
      reason: `CEO approval required: ${matchedApproval.join(", ")}`,
      matched_terms: matchedApproval,
      response_target: input.response_target || input.actor || "CEO",
    };
  }

  return {
    status: "allowed",
    risk_level: "low",
    reversibility: "reversible",
    approval_required: false,
    reason: "Action is reversible and within current safe operational scope.",
    matched_terms: [],
    response_target: input.response_target || input.actor || "CEO",
  };
}

function createDecisionTrace({ actor = "CEO", event, governance, payload = {}, decision = null }) {
  const trace = {
    decision_id: `dt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    actor,
    timestamp: new Date().toISOString(),
    event,
    governance,
    reasoning: governance.reason,
    operational_impact: payload.operational_impact || "controlled_evaluation",
    ecosystem_effect: payload.ecosystem_effect || "no_external_execution",
    approval_context: governance.approval_required ? "ceo_required" : "not_required",
    change_reference: payload.change_reference || "none",
    protected_state: payload.protected_state || "secrets_and_memory_preserved",
    decision,
  };
  const store = leerJSON(DECISION_TRACE_FILE, { traces: [] });
  store.traces.unshift(trace);
  store.traces = store.traces.slice(0, 500);
  guardarJSON(DECISION_TRACE_FILE, store);
  return trace;
}

function recordOperationalMemory(event) {
  const store = leerJSON(OPERATIONAL_MEMORY_FILE, { events: [] });
  store.events.unshift({
    memory_id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...event,
  });
  store.events = store.events.slice(0, 500);
  guardarJSON(OPERATIONAL_MEMORY_FILE, store);
}

async function executeProvider({ provider = process.env.CEREBRO_DEFAULT_PROVIDER || "anthropic", system, userContent, maxTokens = 800 }) {
  const profile = PROVIDER_CONFIG[provider];
  if (!profile) throw new Error("provider_not_registered");
  if (!profile.enabled) throw new Error("provider_missing_credentials");

  if (provider === "anthropic") {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: profile.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: typeof userContent === "string" ? userContent : JSON.stringify(userContent) }],
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 30000,
      }
    );
    return response.data.content[0].text;
  }

  throw new Error("provider_adapter_not_implemented");
}

async function llamarIA(system, userContent, maxTokens = 800) {
  const text = await executeProvider({ system, userContent, maxTokens });
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (_) {
    return { raw: text };
  }
}

async function ejecutarDebate(propuesta, contexto) {
  const debate = { propuesta, criticas: {}, propuesta_mejorada: null };
  const criticas = await Promise.all(
    Object.entries(AGENTES).map(async ([id, agente]) => {
      try {
        const critica = await llamarIA(
          agente.prompt,
          `Propuesta: ${propuesta}\nContexto: ${contexto || "Empresa de agentes IA"}`
        );
        return [id, { ...critica, agente: agente.nombre }];
      } catch (error) {
        return [id, { error: error.message, agente: agente.nombre }];
      }
    })
  );
  criticas.forEach(([id, critica]) => {
    debate.criticas[id] = critica;
  });

  try {
    debate.propuesta_mejorada = await llamarIA(
      `Eres sintetizador ejecutivo. Mejora la propuesta con base en criticas.
Formato JSON: {"propuesta_mejorada":"...","cambios_principales":["cambio 1"]}`,
      { propuesta_original: propuesta, criticas: debate.criticas }
    );
  } catch (_) {
    debate.propuesta_mejorada = { propuesta_mejorada: propuesta, cambios_principales: [] };
  }

  return debate;
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "cerebro",
    governance: "active",
    memory: "active",
    provider_registry: "prepared",
  });
});

app.get("/runtime/status", (_req, res) => {
  res.json({
    status: "active",
    runtime: "cerebro_governed_prototype",
    governance_first: true,
    audit_first: true,
    decision_trace: fs.existsSync(DECISION_TRACE_FILE),
    operational_memory: fs.existsSync(OPERATIONAL_MEMORY_FILE),
    provider_abstraction: "active",
    direct_provider_calls: false,
    provider_ready: PROVIDER_CONFIG.anthropic.enabled,
  });
});

app.get("/governance/status", (_req, res) => {
  res.json({
    status: "active",
    approval_required_for_irreversible: true,
    ceo_override: true,
    anti_loop_protection: "prepared",
    freeze_protection: "prepared",
  });
});

app.post("/api/activar", async (req, res) => {
  const { propuesta, contexto, modulos, tareas, notas } = req.body;
  if (!propuesta) return res.json({ success: false, error: "propuesta requerida" });

  const governance = classifyAction({ action: "proposal_activation", propuesta, contexto, notas, actor: "CEO" });
  if (governance.status !== "allowed") {
    const trace = createDecisionTrace({ event: "proposal_activation_blocked", governance, payload: { protected_state: "provider_not_called_memory_not_mutated" } });
    recordOperationalMemory({ event: "governance_block", governance, summary: propuesta.slice(0, 180) });
    return res.json({ success: false, error: governance.status, governance, decision_trace: trace });
  }

  const memoria = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });

  try {
    const debate = await ejecutarDebate(propuesta, contexto);
    const decision = await llamarIA(
      CEREBRO_PROMPT,
      {
        propuesta_original: propuesta,
        debate,
        historial_reciente: memoria.historial.slice(-5),
        estado_empresa: { modulos, tareas, notas },
      },
      1000
    );

    const trace = createDecisionTrace({
      event: "proposal_activation_completed",
      governance,
      payload: { operational_impact: "decision_generated", ecosystem_effect: "no_external_execution" },
      decision,
    });

    const entrada = {
      fecha: new Date().toISOString(),
      propuesta,
      debate,
      decision,
      governance,
      decision_trace_id: trace.decision_id,
      resultado_registrado: false,
    };
    memoria.historial.unshift(entrada);
    memoria.historial = memoria.historial.slice(0, 50);
    guardarJSON(MEMORY_FILE, memoria);
    recordOperationalMemory({ event: "proposal_decided", proposal: propuesta.slice(0, 180), governance, decision_trace_id: trace.decision_id });

    res.json({ success: true, debate, decision, governance, decision_trace: trace, fecha: new Date().toISOString() });
  } catch (error) {
    const trace = createDecisionTrace({ event: "proposal_activation_failed", governance, payload: { operational_impact: "provider_or_execution_failure" } });
    recordOperationalMemory({ event: "proposal_failed", error: error.message, decision_trace_id: trace.decision_id });
    res.json({ success: false, error: error.message, governance, decision_trace: trace });
  }
});

app.post("/api/resultado", (req, res) => {
  const { accion, resultado, leads, ingresos, notas } = req.body;
  const governance = classifyAction({ action: "result_registration", accion, notas, actor: "CEO" });
  if (governance.status === "blocked") {
    const trace = createDecisionTrace({ event: "result_registration_blocked", governance });
    return res.json({ success: false, error: "blocked_by_governance", governance, decision_trace: trace });
  }

  const resultados = leerJSON(RESULTS_FILE, { registros: [] });
  const trace = createDecisionTrace({ event: "result_registered", governance, payload: { operational_impact: "memory_updated" } });
  resultados.registros.unshift({
    fecha: new Date().toISOString(),
    accion,
    resultado,
    leads: Number(leads) || 0,
    ingresos: Number(ingresos) || 0,
    notas: notas || "",
    governance,
    decision_trace_id: trace.decision_id,
  });
  resultados.registros = resultados.registros.slice(0, 100);
  guardarJSON(RESULTS_FILE, resultados);
  recordOperationalMemory({ event: "result_registered", accion, governance, decision_trace_id: trace.decision_id });
  res.json({ success: true, governance, decision_trace: trace });
});

app.post("/api/aprender", async (_req, res) => {
  const governance = classifyAction({ action: "learning_event", actor: "CEO" });
  const resultados = leerJSON(RESULTS_FILE, { registros: [] });
  const memoria = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });

  if (resultados.registros.length < 2) {
    return res.json({ success: false, error: "Necesitas al menos 2 resultados registrados para aprender", governance });
  }

  try {
    const insights = await llamarIA(APRENDIZAJE_PROMPT, {
      resultados: resultados.registros.slice(0, 20),
      historial_decisiones: memoria.historial.slice(0, 10),
    }, 1000);

    memoria.insights = insights.insights || [];
    memoria.patrones = insights.patrones || [];
    guardarJSON(MEMORY_FILE, memoria);
    const trace = createDecisionTrace({ event: "learning_completed", governance, payload: { operational_impact: "learning_memory_updated" }, decision: insights });
    recordOperationalMemory({ event: "learning_completed", governance, decision_trace_id: trace.decision_id });
    res.json({ success: true, insights, governance, decision_trace: trace });
  } catch (error) {
    const trace = createDecisionTrace({ event: "learning_failed", governance });
    res.json({ success: false, error: error.message, governance, decision_trace: trace });
  }
});

app.get("/api/historial", (_req, res) => {
  const memoria = leerJSON(MEMORY_FILE, { historial: [] });
  res.json({ success: true, historial: memoria.historial.slice(0, 10) });
});

app.get("/api/resultados", (_req, res) => {
  const data = leerJSON(RESULTS_FILE, { registros: [] });
  res.json({ success: true, registros: data.registros.slice(0, 20) });
});

app.get("/api/decision-traces", (_req, res) => {
  const data = leerJSON(DECISION_TRACE_FILE, { traces: [] });
  res.json({ success: true, traces: data.traces.slice(0, 50) });
});

app.get("/api/operational-memory", (_req, res) => {
  const data = leerJSON(OPERATIONAL_MEMORY_FILE, { events: [] });
  res.json({ success: true, events: data.events.slice(0, 50) });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3003;
  app.listen(PORT, () => console.log(`Cerebro governed prototype running on http://localhost:${PORT}`));
}

module.exports = {
  app,
  classifyAction,
  createDecisionTrace,
  recordOperationalMemory,
  executeProvider,
  DATA_DIR,
};
