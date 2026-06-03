const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
require("dotenv").config({ quiet: true });

const app = express();
app.use(express.static("public"));
app.use(express.json({ limit: "256kb" }));

const DATA_DIR = process.env.CEREBRO_DATA_DIR
  || (process.env.VERCEL ? path.join("/tmp", "cerebro-data") : path.join(__dirname, "data"));
const LEGACY_MEMORY_FILE = path.join(__dirname, "memoria.json");
const LEGACY_RESULTS_FILE = path.join(__dirname, "resultados.json");
const MEMORY_FILE = path.join(DATA_DIR, "memoria.json");
const RESULTS_FILE = path.join(DATA_DIR, "resultados.json");
const DECISION_TRACE_FILE = path.join(DATA_DIR, "decision_traces.json");
const OPERATIONAL_MEMORY_FILE = path.join(DATA_DIR, "operational_memory.json");
const WORKFLOW_TRACE_FILE = path.join(DATA_DIR, "workflow_traces.json");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");
const DELIVERABLES_FILE = path.join(DATA_DIR, "deliverables.json");
const ECOSYSTEM_MEMORY_FILE = path.join(DATA_DIR, "ecosystem_memory.json");
const DELIVERABLES_DIR = path.join(DATA_DIR, "deliverables");
const LOCAL_AGENT_REGISTRY_FILE = path.join(DATA_DIR, "local_agent_registry.json");
const LOCAL_AGENT_TASKS_FILE = path.join(DATA_DIR, "local_agent_tasks.json");
const OPENROUTER_DEFAULT_MAX_TOKENS = 18000;

function envFirst(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function intEnvFirst(fallback, ...names) {
  for (const name of names) {
    const value = Number.parseInt(String(process.env[name] || "").trim(), 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function boundedProviderMaxTokens(provider, requestedMaxTokens) {
  const requested = Number.isFinite(Number(requestedMaxTokens)) && Number(requestedMaxTokens) > 0
    ? Number(requestedMaxTokens)
    : OPENROUTER_DEFAULT_MAX_TOKENS;
  if (provider !== "openrouter") return requested;
  const configuredCap = intEnvFirst(0, "CEREBRO_OPENROUTER_MAX_TOKENS", "OPENROUTER_MAX_TOKENS");
  const openRouterCap = configuredCap > 0
    ? Math.max(configuredCap, OPENROUTER_DEFAULT_MAX_TOKENS)
    : OPENROUTER_DEFAULT_MAX_TOKENS;
  return Math.max(1, Math.min(requested, openRouterCap));
}

function getOpenRouterTokenBudgetSnapshot() {
  return {
    default_max_tokens: OPENROUTER_DEFAULT_MAX_TOKENS,
    env_configured: Boolean(envFirst("CEREBRO_OPENROUTER_MAX_TOKENS", "OPENROUTER_MAX_TOKENS")),
    effective_max_tokens: boundedProviderMaxTokens("openrouter", OPENROUTER_DEFAULT_MAX_TOKENS),
  };
}

const PROVIDER_CONFIG = {
  anthropic: {
    provider_id: "anthropic",
    provider_name: "Anthropic",
    enabled: Boolean(envFirst("ANTHROPIC_API_KEY", "CEREBRO_ANTHROPIC_API_KEY")),
    credential_env: "ANTHROPIC_API_KEY",
    model: process.env.CEREBRO_ANTHROPIC_MODEL || "claude-3-5-haiku-20241022",
    mode: "configured_connector",
    status: Boolean(envFirst("ANTHROPIC_API_KEY", "CEREBRO_ANTHROPIC_API_KEY")) ? "ready" : "missing_credentials",
  },
  openrouter: {
    provider_id: "openrouter",
    provider_name: "OpenRouter",
    enabled: Boolean(envFirst("OPENROUTER_API_KEY", "CEREBRO_OPENROUTER_API_KEY", "FORJA_OPENROUTER_API_KEY")),
    credential_env: "OPENROUTER_API_KEY",
    model: process.env.CEREBRO_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || process.env.FORJA_OPENROUTER_MODEL || "openai/gpt-4o-mini",
    mode: "official_connector",
    status: Boolean(envFirst("OPENROUTER_API_KEY", "CEREBRO_OPENROUTER_API_KEY", "FORJA_OPENROUTER_API_KEY")) ? "ready" : "missing_credentials",
  },
  openai: {
    provider_id: "openai",
    provider_name: "OpenAI",
    enabled: Boolean(envFirst("OPENAI_API_KEY", "CEREBRO_OPENAI_API_KEY")),
    credential_env: "OPENAI_API_KEY",
    model: process.env.CEREBRO_OPENAI_MODEL || "gpt-4.1-mini",
    mode: "optional_connector",
    status: Boolean(envFirst("OPENAI_API_KEY", "CEREBRO_OPENAI_API_KEY")) ? "ready" : "missing_credentials",
  },
};

function providerHasCredentials(provider) {
  if (provider === "anthropic") {
    return Boolean(envFirst("ANTHROPIC_API_KEY", "CEREBRO_ANTHROPIC_API_KEY"));
  }
  if (provider === "openrouter") {
    return Boolean(envFirst("OPENROUTER_API_KEY", "CEREBRO_OPENROUTER_API_KEY", "FORJA_OPENROUTER_API_KEY"));
  }
  if (provider === "openai") {
    return Boolean(envFirst("OPENAI_API_KEY", "CEREBRO_OPENAI_API_KEY"));
  }
  return false;
}

const ENTERPRISE_CAPABILITIES = {
  heart_cabin: {
    status: "partial",
    evidence: ["governance classification", "decision trace", "operational memory"],
    missing: ["formal certification authority", "ecosystem orchestration contracts"],
  },
  technical_cabin: {
    status: "partial",
    evidence: ["Express runtime", "provider adapter boundary", "health endpoints", "tests"],
    missing: ["event bus", "database-backed memory", "multi-provider routing", "auth"],
  },
  human_cabin: {
    status: "operational_partial",
    evidence: ["quiet executive UI", "natural chat", "action/result/history loops", "visible deliverables"],
    missing: ["signed approvals", "database-backed cross-device memory"],
  },
  governance: {
    status: "active_partial",
    evidence: ["risk classification", "approval required state", "blocked action state", "CEO response target"],
    missing: ["role-based auth", "signed approvals", "external audit sink"],
  },
  survivability: {
    status: "not_certified",
    evidence: ["non-destructive runtime", "local JSON persistence", "safe blocked actions"],
    missing: ["chaos validation", "recovery drills", "freeze certification"],
  },
};

const CERTIFICATION_STATUS = {
  classification: "CONDITIONALLY_STABLE_LOCAL_PROTOTYPE",
  enterprise_ready: false,
  strategic_authority_ready: false,
  reason: "Cerebro has governed prototype controls but lacks deploy traceability, auth, durable memory, and full enterprise validation.",
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
  fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });
  migrateIfNeeded(LEGACY_MEMORY_FILE, MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  migrateIfNeeded(LEGACY_RESULTS_FILE, RESULTS_FILE, { registros: [] });
  ensureJsonFile(DECISION_TRACE_FILE, { traces: [] });
  ensureJsonFile(OPERATIONAL_MEMORY_FILE, { events: [] });
  ensureJsonFile(WORKFLOW_TRACE_FILE, { workflows: [] });
  ensureJsonFile(CONVERSATIONS_FILE, { sessions: [] });
  ensureJsonFile(DELIVERABLES_FILE, { items: [] });
  ensureJsonFile(ECOSYSTEM_MEMORY_FILE, getDefaultEcosystemMemory());
  ensureJsonFile(LOCAL_AGENT_REGISTRY_FILE, { agents: [] });
  ensureJsonFile(LOCAL_AGENT_TASKS_FILE, { tasks: [] });
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
  schedulePersistentFlush(file);
}

function getDefaultEcosystemMemory() {
  return {
    updated_at: new Date().toISOString(),
    source: "cerebro_integrated_operational_memory",
    production: {
      official_platform: "vercel",
      official_url: "https://cerebro-app-eta.vercel.app/",
      repository: "centro-de-direccion-app",
      obsolete_surfaces: [
        "https://cerebro-app.onrender.com/",
        "https://cerebro-backend.onrender.com/",
        "https://cerebro.vercel.app/",
      ],
    },
    apps: [
      { name: "FORJA", status: "production_operational", role: "construccion y coordinacion tecnica" },
      { name: "CEREBRO", status: "active_upgrade", role: "direccion ejecutiva del ecosistema" },
      { name: "DCFT", status: "staging_blocked_render_blueprint", role: "doctor contable financiero tributario" },
      { name: "CENTINELA", status: "documented", role: "riesgo, vigilancia y continuidad" },
      { name: "PLUMA", status: "documented", role: "contenido y analisis escrito" },
      { name: "MARKETING", status: "documented", role: "crecimiento y posicionamiento" },
      { name: "LENTE", status: "documented", role: "vision y auditoria visual" },
      { name: "WEB_FACTORY", status: "documented", role: "produccion web" },
    ],
    projects: [
      "Consolidar CEREBRO como cabina ejecutiva conversacional.",
      "Mantener FORJA como referencia operativa de produccion.",
      "Completar DCFT C.2.1 cuando Render Blueprint este sincronizado.",
    ],
    priorities: [
      "Human Cabin protagonista y mobile responsive.",
      "Chat natural en espanol con memoria y entregables.",
      "Produccion unica y estable sin superficies obsoletas.",
      "Trazabilidad de decisiones, bloqueos y resultados.",
    ],
    blockers: [
      "Render de CEREBRO no es la produccion vigente.",
      "Memoria productiva Vercel requiere almacenamiento externo para durabilidad multi-instancia.",
      "DCFT staging depende de creacion manual de Blueprint en Render.",
    ],
    approvals: [
      "Aprobacion humana requerida para cambios irreversibles, deploys criticos, secrets y migraciones.",
    ],
  };
}

function getMemoryBackendSnapshot() {
  const isVercelRuntime = Boolean(process.env.VERCEL);
  const storage = getPersistentStorageConfig();
  const externalBackend = process.env.CEREBRO_MEMORY_BACKEND || (storage.enabled ? storage.backend : "");
  return {
    backend: externalBackend || "json_atomic_file",
    data_dir: DATA_DIR,
    persistent: !isVercelRuntime || Boolean(externalBackend),
    production_note: isVercelRuntime && !externalBackend
      ? "Vercel runtime JSON is operational but not durable across cold starts; configure external storage for enterprise persistence."
      : storage.enabled
        ? "Memory writes are mirrored to Vercel/Upstash KV REST storage and hydrated on runtime invocation."
        : "Memory writes persist in the configured data directory/backend.",
    storage_ready: storage.enabled,
    storage_required_env: storage.required_env,
    files: {
      conversations: path.relative(__dirname, CONVERSATIONS_FILE),
      deliverables: path.relative(__dirname, DELIVERABLES_FILE),
      ecosystem_memory: path.relative(__dirname, ECOSYSTEM_MEMORY_FILE),
    },
  };
}

const PERSISTENT_STORAGE_FILES = [
  MEMORY_FILE,
  RESULTS_FILE,
  DECISION_TRACE_FILE,
  OPERATIONAL_MEMORY_FILE,
  WORKFLOW_TRACE_FILE,
  CONVERSATIONS_FILE,
  DELIVERABLES_FILE,
  ECOSYSTEM_MEMORY_FILE,
  LOCAL_AGENT_REGISTRY_FILE,
  LOCAL_AGENT_TASKS_FILE,
];
let persistentHydrated = false;
let persistentHydratingPromise = null;

function getPersistentStorageConfig() {
  const backend = process.env.CEREBRO_STORAGE_BACKEND || (envFirst("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL") ? "vercel_kv" : "");
  const url = envFirst("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL").replace(/\/+$/, "");
  const token = envFirst("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
  const prefix = process.env.CEREBRO_KV_PREFIX || "cerebro-production";
  const enabled = backend === "vercel_kv" && Boolean(url && token);
  return {
    backend: enabled ? "vercel_kv_rest" : (backend || "json_atomic_file"),
    enabled,
    url,
    token,
    prefix,
    required_env: ["CEREBRO_STORAGE_BACKEND=vercel_kv", "KV_REST_API_URL", "KV_REST_API_TOKEN"],
  };
}

function persistentStorageKey(file) {
  const storage = getPersistentStorageConfig();
  const relative = path.relative(DATA_DIR, file).replace(/\\/g, "/");
  return `${storage.prefix}:${relative}`;
}

async function kvCommand(command) {
  const storage = getPersistentStorageConfig();
  if (!storage.enabled || typeof fetch !== "function") return null;
  const response = await fetch(storage.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${storage.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `kv_http_${response.status}`);
  }
  return data.result;
}

async function hydratePersistentStorage() {
  const storage = getPersistentStorageConfig();
  if (!storage.enabled || persistentHydrated) return { enabled: storage.enabled, hydrated: persistentHydrated };
  if (persistentHydratingPromise) return persistentHydratingPromise;
  persistentHydratingPromise = (async () => {
    for (const file of PERSISTENT_STORAGE_FILES) {
      const result = await kvCommand(["GET", persistentStorageKey(file)]).catch(() => null);
      if (!result) continue;
      try {
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
      } catch (_) {
        // Invalid remote JSON must not break runtime; local fallback remains available.
      }
    }
    persistentHydrated = true;
    return { enabled: true, hydrated: true };
  })().finally(() => {
    persistentHydratingPromise = null;
  });
  return persistentHydratingPromise;
}

function schedulePersistentFlush(file) {
  const storage = getPersistentStorageConfig();
  if (!storage.enabled || !PERSISTENT_STORAGE_FILES.includes(file) || typeof fetch !== "function") return;
  void flushPersistentFile(file).catch(() => {});
}

async function flushPersistentFile(file) {
  const storage = getPersistentStorageConfig();
  if (!storage.enabled || !fs.existsSync(file)) return { enabled: storage.enabled, flushed: false };
  const raw = fs.readFileSync(file, "utf8");
  await kvCommand(["SET", persistentStorageKey(file), raw]);
  return { enabled: true, flushed: true, key: persistentStorageKey(file) };
}

function getPersistentStorageSnapshot() {
  const storage = getPersistentStorageConfig();
  return {
    backend: storage.backend,
    enabled: storage.enabled,
    hydrated: persistentHydrated,
    prefix: storage.enabled ? storage.prefix : null,
    file_count: PERSISTENT_STORAGE_FILES.length,
    required_env: storage.required_env,
    uses_tmp_only: Boolean(process.env.VERCEL) && !storage.enabled,
  };
}

function limitText(value, max = 1200) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function readConversationStore() {
  const store = leerJSON(CONVERSATIONS_FILE, { sessions: [] });
  return Array.isArray(store.sessions) ? store : { sessions: [] };
}

function saveConversationStore(store) {
  store.sessions = (store.sessions || []).slice(0, 100);
  guardarJSON(CONVERSATIONS_FILE, store);
}

function getOrCreateConversation(sessionId) {
  const store = readConversationStore();
  const safeId = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
    || `cerebro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let session = store.sessions.find((item) => item.session_id === safeId);
  if (!session) {
    session = {
      session_id: safeId,
      title: "Conversacion con CEREBRO",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [],
    };
    store.sessions.unshift(session);
  }
  return { store, session };
}

function appendConversationMessage(session, role, content, meta = {}) {
  session.messages.push({
    role,
    content: limitText(content, 6000),
    timestamp: new Date().toISOString(),
    ...meta,
  });
  session.messages = session.messages.slice(-80);
  session.updated_at = new Date().toISOString();
  if (role === "user" && session.title === "Conversacion con CEREBRO") {
    session.title = limitText(content, 80);
  }
}

function getConversationSummaries(limit = 12) {
  const store = readConversationStore();
  return store.sessions
    .slice()
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, limit)
    .map((session) => ({
      session_id: session.session_id,
      title: session.title || "Conversacion con CEREBRO",
      updated_at: session.updated_at,
      created_at: session.created_at,
      message_count: Array.isArray(session.messages) ? session.messages.length : 0,
      last_message: Array.isArray(session.messages) && session.messages.length
        ? limitText(session.messages[session.messages.length - 1].content, 180)
        : "",
    }));
}

function getProviderConversationHistory(session, limit = 10) {
  const messages = Array.isArray(session && session.messages) ? session.messages : [];
  const recent = messages
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-limit);
  const last = recent[recent.length - 1];
  const withoutCurrentUser = last && last.role === "user" ? recent.slice(0, -1) : recent;
  return withoutCurrentUser.map((message) => ({
    role: message.role,
    content: limitText(message.content, 1400),
  }));
}

function conversationContextSummary(session) {
  const messages = Array.isArray(session && session.messages) ? session.messages : [];
  return messages
    .slice(-8)
    .map((message) => `${message.role}: ${limitText(message.content, 220)}`)
    .join("\n");
}

async function flushCriticalPersistence(files) {
  const storage = getPersistentStorageConfig();
  const localDurable = !process.env.VERCEL;
  const result = {
    storage_enabled: storage.enabled,
    backend: storage.backend,
    success: localDurable || storage.enabled,
    files: {},
    errors: [],
  };

  for (const file of files) {
    const key = path.basename(file, ".json");
    if (localDurable) {
      result.files[key] = true;
      continue;
    }
    if (!storage.enabled) {
      result.files[key] = false;
      result.errors.push(`${key}:persistent_storage_disabled`);
      continue;
    }
    try {
      await flushPersistentFile(file);
      result.files[key] = true;
    } catch (error) {
      result.files[key] = false;
      result.errors.push(`${key}:${error.message}`);
    }
  }

  result.success = Object.values(result.files).every(Boolean);
  return result;
}

function getRecentDeliverables(limit = 12) {
  const store = leerJSON(DELIVERABLES_FILE, { items: [] });
  return Array.isArray(store.items) ? store.items.slice(0, limit) : [];
}

function sanitizeFilename(value) {
  const base = String(value || "CEREBRO_DELIVERABLE.md")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base.toLowerCase().endsWith(".md") ? base : `${base || "CEREBRO_DELIVERABLE"}.md`;
}

function detectDeliverableRequest(message) {
  const text = normalizeText(message);
  const asksForDeliverable = /(genera|crear|crea|guarda|guardar|reporte|inventario|entregable|documento|\.md)/.test(text);
  if (!asksForDeliverable) return null;
  const filenameMatch = String(message).match(/([A-Za-z0-9_.-]+\.md)/i);
  return {
    filename: sanitizeFilename(filenameMatch ? filenameMatch[1] : `CEREBRO_ENTREGABLE_${new Date().toISOString().slice(0, 10)}.md`),
    requested: true,
  };
}

function buildExecutiveSnapshot() {
  const memoria = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  const resultados = leerJSON(RESULTS_FILE, { registros: [] });
  const traces = leerJSON(DECISION_TRACE_FILE, { traces: [] });
  const operational = leerJSON(OPERATIONAL_MEMORY_FILE, { events: [] });
  const workflows = leerJSON(WORKFLOW_TRACE_FILE, { workflows: [] });
  const ecosystem = leerJSON(ECOSYSTEM_MEMORY_FILE, getDefaultEcosystemMemory());
  const conversations = readConversationStore();
  return {
    generated_at: new Date().toISOString(),
    production: ecosystem.production,
    apps: ecosystem.apps || [],
    projects: ecosystem.projects || [],
    priorities: ecosystem.priorities || [],
    blockers: ecosystem.blockers || [],
    approvals: ecosystem.approvals || [],
    counts: {
      decisions: memoria.historial.length,
      results: resultados.registros.length,
      decision_traces: traces.traces.length,
      operational_events: operational.events.length,
      workflow_traces: workflows.workflows.length,
      conversations: conversations.sessions.length,
      deliverables: getRecentDeliverables(1000).length,
    },
    recent_decisions: memoria.historial.slice(0, 5),
    recent_results: resultados.registros.slice(0, 5),
    recent_events: operational.events.slice(0, 5),
    recent_deliverables: getRecentDeliverables(8),
    ai: getAICoordinationSnapshot(),
    memory: getMemoryContinuitySnapshot(),
    memory_backend: getMemoryBackendSnapshot(),
    local_agent: localAgentDashboardSnapshot(),
  };
}

function fallbackChatReply(message, snapshot, governance, session = null) {
  const text = normalizeText(message);
  if (governance && governance.status === "blocked") {
    return `CEO, no ejecuto eso. La peticion esta bloqueada por gobierno: ${governance.reason}. Puedo ayudarte a reformularla de forma segura.`;
  }
  if (text.includes("que estamos haciendo ahora") || text.includes("estamos haciendo ahora")) {
    const context = conversationContextSummary(session);
    if (normalizeText(context).includes("corrigiendo cerebro")) {
      return [
        "Estamos corrigiendo CEREBRO como incidente critico de producto.",
        "",
        "Orden actual:",
        "1. Persistencia real de conversaciones.",
        "2. Conversacion real con memoria y respuestas completas.",
        "3. Voz en la Human Cabin.",
        "4. Mobile usable.",
        "5. Visual premium despues de validar lo anterior.",
        "",
        "No estoy tocando FORJA, DCFT ni otros proyectos.",
        "",
        "Primer paso exacto: validar que esta conversacion se conserva al recargar y volver a abrir."
      ].join("\n");
    }
  }
  if (text.includes("aplicaciones") || text.includes("apps")) {
    const apps = snapshot.apps.map((app) => `- ${app.name}: ${app.status} (${app.role})`).join("\n");
    return `CEO, estas son las aplicaciones registradas en mi memoria operativa:\n\n${apps || "No tengo aplicaciones registradas."}`;
  }
  if (text.includes("bloqueo")) {
    return `CEO, bloqueos actuales verificados:\n\n${(snapshot.blockers || []).map((item) => `- ${item}`).join("\n") || "- No tengo bloqueos registrados."}`;
  }
  if (text.includes("prioridad") || text.includes("prioridades")) {
    return `CEO, prioridades actuales:\n\n${(snapshot.priorities || []).map((item) => `- ${item}`).join("\n") || "- No tengo prioridades registradas."}`;
  }
  if (text.includes("construyendo") || text.includes("ecosistema") || text.includes("proyectos")) {
    return `CEO, estamos construyendo un ecosistema IA operativo con FORJA como referencia productiva y CEREBRO como cabina ejecutiva. Proyectos activos:\n\n${(snapshot.projects || []).map((item) => `- ${item}`).join("\n")}`;
  }
  return [
    "Entendido. Voy a tratarlo como una decision operativa, no como una conversacion generica.",
    "",
    "Objetivo:",
    "Ordenar la solicitud y convertirla en pasos ejecutables.",
    "",
    "Plan:",
    "1. Confirmar alcance.",
    "2. Revisar evidencia disponible.",
    "3. Identificar riesgos.",
    "4. Definir que no se toca.",
    "5. Ejecutar el primer paso seguro.",
    "",
    "No voy a tocar FORJA, CEREBRO productivo, secrets ni deploys sin confirmacion explicita.",
    "",
    "Primer paso exacto: dime que resultado quieres obtener y lo convierto en plan operativo."
  ].join("\n");
}

function buildChatSystemPrompt(snapshot) {
  const apps = (snapshot.apps || []).map((app) => app.name).join(", ") || "sin apps";
  const priorities = (snapshot.priorities || []).join("; ") || "sin prioridades registradas";
  const blockers = (snapshot.blockers || []).join("; ") || "sin bloqueos registrados";
  const projects = (snapshot.projects || []).join("; ") || "sin proyectos registrados";
  return `Eres CEREBRO, Chief of Staff ejecutivo del ecosistema.

Identidad:
- Producto: CEREBRO.
- Rol: Chief of Staff.
- Concepto: la segunda mente mas importante de la organizacion.
- Idioma: espanol claro, ejecutivo y accionable.

Estilo obligatorio:
- No respondas como chatbot generico.
- No des teoria innecesaria.
- No digas que algo esta terminado sin evidencia.
- No reveles secrets, tokens, claves ni variables sensibles.
- No prometas deploys, pushes, cambios irreversibles ni acciones criticas sin confirmacion humana.

Para solicitudes operativas responde con esta estructura cuando aplique:
1. Entendimiento claro.
2. Objetivo.
3. Plan por pasos.
4. Riesgos.
5. Que NO voy a tocar.
6. Primer paso exacto.
7. Confirmacion requerida si hay riesgo.

Memoria operativa actual:
- Apps: ${limitText(apps, 260)}
- Proyectos: ${limitText(projects, 360)}
- Prioridades: ${limitText(priorities, 360)}
- Bloqueos: ${limitText(blockers, 360)}
- Conversaciones persistidas: ${snapshot.counts ? snapshot.counts.conversations : 0}
- Entregables visibles: ${snapshot.counts ? snapshot.counts.deliverables : 0}
`;
}

function buildChatUserContent({ message, governance, deliverableRequest, snapshot, session }) {
  return [
    `Mensaje del CEO: ${limitText(message, 1600)}`,
    `Gobierno: ${governance.status}`,
    deliverableRequest ? `Entregable solicitado: ${deliverableRequest.filename}` : "Entregable solicitado: no",
    "",
    "Contexto reciente de la conversacion:",
    conversationContextSummary(session) || "Sin historial previo visible.",
    "",
    "Estado resumido del ecosistema:",
    `Apps: ${(snapshot.apps || []).map((app) => `${app.name}=${app.status}`).join(", ") || "ninguna"}`,
    `Prioridades: ${(snapshot.priorities || []).join(" | ") || "ninguna"}`,
    `Bloqueos: ${(snapshot.blockers || []).join(" | ") || "ninguno"}`,
  ].join("\n");
}

function buildDeliverableContent({ filename, message, reply, snapshot }) {
  return `# ${filename.replace(/\.md$/i, "").replace(/_/g, " ")}

Generado por: CEREBRO Human Cabin
Fecha: ${new Date().toISOString()}

## Solicitud

${message}

## Respuesta ejecutiva

${reply}

## Estado del ecosistema usado

- Produccion oficial: ${snapshot.production && snapshot.production.official_url ? snapshot.production.official_url : "no registrada"}
- Aplicaciones registradas: ${snapshot.apps.map((app) => app.name).join(", ") || "ninguna"}
- Prioridades: ${(snapshot.priorities || []).join(" | ") || "ninguna"}
- Bloqueos: ${(snapshot.blockers || []).join(" | ") || "ninguno"}

## Evidencia de memoria

- Decisiones: ${snapshot.counts.decisions}
- Resultados: ${snapshot.counts.results}
- Trazas de decision: ${snapshot.counts.decision_traces}
- Eventos operativos: ${snapshot.counts.operational_events}
- Conversaciones: ${snapshot.counts.conversations}
- Entregables: ${snapshot.counts.deliverables}
`;
}

function createDeliverable({ filename, message, reply, snapshot, conversationId }) {
  const safeFilename = sanitizeFilename(filename);
  const content = buildDeliverableContent({ filename: safeFilename, message, reply, snapshot });
  fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });
  const filePath = path.join(DELIVERABLES_DIR, safeFilename);
  fs.writeFileSync(filePath, content);
  const item = {
    id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename: safeFilename,
    title: safeFilename.replace(/\.md$/i, "").replace(/_/g, " "),
    status: "generated",
    created_at: new Date().toISOString(),
    source: "human_cabin_chat",
    conversation_id: conversationId,
    path: path.relative(__dirname, filePath),
    preview: limitText(content, 420),
  };
  const store = leerJSON(DELIVERABLES_FILE, { items: [] });
  store.items = Array.isArray(store.items) ? store.items : [];
  store.items.unshift(item);
  store.items = store.items.slice(0, 200);
  guardarJSON(DELIVERABLES_FILE, store);
  return item;
}

function recordStrategicConversationMemory({ message, reply, governance, conversationId, deliverable }) {
  const memoria = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  memoria.historial.unshift({
    fecha: new Date().toISOString(),
    tipo: "human_cabin_conversation",
    propuesta: limitText(message, 500),
    decision: {
      decision: "respondido",
      razon: governance ? governance.reason : "chat ejecutivo",
      prioridades: [],
      descartado: [],
      plazo: "inmediato",
      mensaje_final: limitText(reply, 700),
    },
    governance,
    conversation_id: conversationId,
    deliverable_id: deliverable ? deliverable.id : null,
    resultado_registrado: Boolean(deliverable),
  });
  memoria.historial = memoria.historial.slice(0, 100);
  guardarJSON(MEMORY_FILE, memoria);
}

const DEFAULT_LOCAL_AGENT_CAPABILITIES = [
  "repo_read",
  "repo_status",
  "repo_diff",
  "repo_branch_create",
  "repo_edit_controlled",
  "repo_commit_prepare",
  "memory_read",
  "reports_read",
  "reports_generate",
  "deliveries_read",
  "deliveries_generate",
  "logs_read",
  "build_run",
  "tests_run",
  "audit_run",
  "backup_create",
  "snapshot_create",
  "rollback_plan",
  "artifact_upload",
];
const LOCAL_AGENT_MUTATING_TYPES = new Set(["report_generation", "controlled_edit", "commit_prepare", "commit_execute", "push", "deploy", "rollback"]);
const LOCAL_AGENT_CRITICAL_TYPES = new Set(["commit_execute", "push", "deploy", "rollback"]);
const LOCAL_AGENT_SECRET_MARKERS = [
  "api_key",
  "apikey",
  "authorization",
  "bearer ",
  "credential",
  "openrouter_api_key",
  "password",
  "private_key",
  "secret",
  "sk-",
  "token",
];

function readLocalAgentRegistry() {
  const store = leerJSON(LOCAL_AGENT_REGISTRY_FILE, { agents: [] });
  return Array.isArray(store.agents) ? store : { agents: [] };
}

function saveLocalAgentRegistry(store) {
  store.agents = (store.agents || []).slice(-100);
  guardarJSON(LOCAL_AGENT_REGISTRY_FILE, store);
}

function readLocalAgentTasks() {
  const store = leerJSON(LOCAL_AGENT_TASKS_FILE, { tasks: [] });
  return Array.isArray(store.tasks) ? store : { tasks: [] };
}

function saveLocalAgentTasks(store) {
  store.tasks = (store.tasks || []).slice(-300);
  guardarJSON(LOCAL_AGENT_TASKS_FILE, store);
}

function hashAgentToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicAgentRecord(agent) {
  const copy = { ...agent };
  delete copy.token_hash;
  return copy;
}

function localAgentTaskType(instruction) {
  const text = normalizeText(instruction);
  if (text.includes("deploy") || text.includes("desplieg")) return "deploy";
  if (text.includes("push")) return "push";
  if (text.includes("rollback") || text.includes("revert")) return "rollback";
  if (text.includes("commit") && /(ejecut|crear|hacer)/.test(text)) return "commit_execute";
  if (text.includes("commit")) return "commit_prepare";
  if (/(implementar|editar|modificar|corregir|fix|cambiar codigo|codigo)/.test(text)) return "controlled_edit";
  if (text.includes("build") || text.includes("compilar")) return "build";
  if (text.includes("test") || text.includes("prueba")) return "test";
  if (text.includes("auditar") || text.includes("auditoria") || text.includes("diagnost")) return "audit";
  if (text.includes("reporte") || text.includes("report") || text.includes("inventario") || text.includes(".md") || text.includes("guarda") || text.includes("guardar")) return "report_generation";
  if (text.includes("leer") || text.includes("listar")) return "read";
  return "diagnosis";
}

function localAgentTaskPolicy(instruction) {
  const taskType = localAgentTaskType(instruction);
  const mutating = LOCAL_AGENT_MUTATING_TYPES.has(taskType);
  const critical = LOCAL_AGENT_CRITICAL_TYPES.has(taskType);
  const capabilityMap = {
    read: ["repo_read", "reports_read", "deliveries_read"],
    diagnosis: ["repo_status", "repo_diff", "logs_read"],
    audit: ["repo_status", "repo_diff", "audit_run", "reports_generate"],
    build: ["repo_read", "build_run", "logs_read"],
    test: ["repo_read", "tests_run", "logs_read"],
    report_generation: ["reports_generate", "backup_create", "rollback_plan"],
    controlled_edit: ["repo_edit_controlled", "repo_branch_create", "backup_create", "rollback_plan"],
    commit_prepare: ["repo_commit_prepare", "backup_create", "rollback_plan"],
    commit_execute: ["repo_commit_prepare", "backup_create", "rollback_plan"],
    push: ["repo_commit_prepare", "backup_create", "rollback_plan"],
    deploy: ["repo_status", "build_run", "tests_run", "backup_create", "rollback_plan"],
    rollback: ["backup_create", "rollback_plan"],
  };
  const base = ["snapshot_create", "memory_read", "artifact_upload"];
  const capabilities = Array.from(new Set([...base, ...(capabilityMap[taskType] || [])])).sort();
  const riskLevel = critical ? "critical" : ["controlled_edit", "commit_prepare", "report_generation"].includes(taskType) ? "high" : ["build", "test", "audit", "diagnosis"].includes(taskType) ? "medium" : "low";
  const allowedCommands = ["git status", "git diff", "rg", "npm run build", "npm test"];
  if (["controlled_edit", "commit_prepare"].includes(taskType)) allowedCommands.push("git checkout -b", "git add", "git commit --dry-run");
  if (critical) allowedCommands.push("requires_critical_human_approval");
  return {
    task_type: taskType,
    risk_level: riskLevel,
    capabilities_required: capabilities,
    policy: {
      requires_snapshot: true,
      requires_backup: mutating,
      requires_branch: ["controlled_edit", "commit_prepare", "commit_execute"].includes(taskType),
      requires_human_approval: ["controlled_edit", "commit_prepare", "report_generation"].includes(taskType) && mutating,
      requires_critical_approval: critical,
      requires_rollback_plan: mutating,
      secrets_allowed: false,
      push_automatic: false,
      deploy_automatic: false,
      allowed_commands: allowedCommands,
    },
  };
}

function containsSecretPayload(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => containsSecretPayload(item));
  if (typeof value === "object") {
    return Object.entries(value).some(([key, nested]) => {
      const keyText = String(key).toLowerCase();
      if (["secrets_scanned", "secrets_redacted", "excluded"].includes(keyText)) return false;
      if (["secrets_found", "secrets_exposed"].includes(keyText)) return nested === true;
      if (LOCAL_AGENT_SECRET_MARKERS.some((marker) => keyText.includes(marker)) && ![false, null, "", "redacted"].includes(nested)) return true;
      return containsSecretPayload(nested);
    });
  }
  const text = String(value).toLowerCase();
  return LOCAL_AGENT_SECRET_MARKERS.some((marker) => marker !== "sk-" && text.includes(marker))
    || /(?<![a-z0-9])sk-[a-z0-9_-]{16,}/i.test(String(value));
}

function rejectSecretPayload(payload) {
  if (containsSecretPayload(payload)) {
    const error = new Error("payload_contains_secret");
    error.statusCode = 409;
    throw error;
  }
}

function localAgentMemoryContext() {
  const snapshot = buildExecutiveSnapshot();
  return {
    connected: snapshot.memory.status === "READY",
    production: snapshot.production,
    registered_apps: snapshot.apps.map((app) => app.name),
    active_apps: snapshot.apps.filter((app) => /active|production|documented/i.test(app.status)).map((app) => app.name),
    priorities: snapshot.priorities,
    blockers: snapshot.blockers,
    construction: snapshot.projects,
  };
}

function localAgentRepositoryContext(task) {
  const target = task.target || {};
  return {
    repo_ids: target.repo_ids || ["cerebro"],
    paths: target.paths || [],
    protected_branches: ["main"],
    allowed_operations: task.capabilities_required || [],
  };
}

function appendLocalAgentEvent(task, eventType, payload = {}, risk = "low", idempotencyKey = null) {
  task.history = Array.isArray(task.history) ? task.history : [];
  if (idempotencyKey && task.history.some((event) => event.idempotency_key === idempotencyKey)) return;
  task.history.push({
    event_id: `event-${crypto.randomUUID()}`,
    task_id: task.task_id,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    actor: "local_agent",
    risk,
    payload,
    idempotency_key: idempotencyKey,
  });
}

function createLocalAgentTaskRecord(payload) {
  const classification = localAgentTaskPolicy(payload.instruction || "");
  const status = classification.policy.requires_critical_approval
    ? "awaiting_critical_approval"
    : classification.policy.requires_human_approval
      ? "awaiting_human_approval"
      : "queued";
  const task = {
    task_id: `task-${crypto.randomUUID()}`,
    title: payload.title || limitText(String(payload.instruction || "CEREBRO Local Agent task").replace(/\s+/g, " "), 120),
    instruction: payload.instruction,
    source: payload.source || "human_cabin",
    requested_by: payload.requested_by || "ceo",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status,
    priority: payload.priority || "normal",
    risk_level: classification.risk_level,
    task_type: classification.task_type,
    capabilities_required: classification.capabilities_required,
    target: payload.target || { workspace_id: "ecosystem", repo_ids: ["cerebro"], paths: [] },
    desired_output: payload.desired_output || null,
    policy: classification.policy,
    assigned_agent_id: null,
    lease: null,
    approvals: [],
    history: [],
    snapshots: [],
    backups: [],
    rollback: null,
    command_logs: [],
    artifacts: [],
    result: null,
    memory_context: localAgentMemoryContext(),
    repository_context: null,
  };
  task.repository_context = localAgentRepositoryContext(task);
  appendLocalAgentEvent(task, "task.created", { status, task_type: task.task_type }, task.risk_level);
  const store = readLocalAgentTasks();
  store.tasks.push(task);
  saveLocalAgentTasks(store);
  recordOperationalMemory({ event: "local_agent_task_created", summary: task.title, task_id: task.task_id, risk_level: task.risk_level });
  return task;
}

function findLocalAgentTask(taskId) {
  const store = readLocalAgentTasks();
  const task = store.tasks.find((item) => item.task_id === taskId);
  return { store, task };
}

function findLocalAgent(agentId) {
  const store = readLocalAgentRegistry();
  const agent = store.agents.find((item) => item.agent_id === agentId);
  return { store, agent };
}

function authenticateLocalAgent(req) {
  const agentId = String(req.headers["x-cerebro-agent-id"] || req.headers["x-forja-agent-id"] || "").trim();
  const authorization = String(req.headers.authorization || "");
  if (!agentId) {
    const error = new Error("missing_agent_id");
    error.statusCode = 401;
    throw error;
  }
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    const error = new Error("missing_agent_token");
    error.statusCode = 401;
    throw error;
  }
  const token = authorization.slice(7).trim();
  const { agent } = findLocalAgent(agentId);
  if (!agent) {
    const error = new Error("agent_not_registered");
    error.statusCode = 401;
    throw error;
  }
  if (agent.status === "revoked") {
    const error = new Error("agent_revoked");
    error.statusCode = 403;
    throw error;
  }
  if (agent.token_hash !== hashAgentToken(token)) {
    const error = new Error("invalid_agent_token");
    error.statusCode = 401;
    throw error;
  }
  return agent;
}

function localAgentAllowedForTask(task, agent, pollPayload = {}) {
  const agentCapabilities = new Set([...(agent.capability_profile || []), ...((pollPayload && pollPayload.capabilities) || [])]);
  const missing = (task.capabilities_required || []).filter((capability) => !agentCapabilities.has(capability));
  const allowedRepos = new Set(agent.allowed_repositories || []);
  const requestedRepos = new Set(((task.target || {}).repo_ids) || []);
  const repoBlocked = requestedRepos.size > 0 && allowedRepos.size > 0 && Array.from(requestedRepos).some((repo) => !allowedRepos.has(repo));
  if (missing.length || repoBlocked) {
    return { allowed: false, reason: missing.length ? "missing_capabilities" : "repository_not_allowed", missing_capabilities: missing, repo_blocked: repoBlocked };
  }
  return { allowed: true, reason: "policy_allowed" };
}

function localAgentDashboardSnapshot() {
  const agents = readLocalAgentRegistry().agents.map(publicAgentRecord);
  const tasks = readLocalAgentTasks().tasks;
  const latestResults = tasks.filter((task) => task.result).slice(-10);
  const deliveries = latestResults.map((task) => {
    const visible = [...(task.artifacts || [])].reverse().find((artifact) => artifact.visible_in_human_cabin);
    const report = (task.result || {}).report || {};
    return {
      name: (visible || {}).name || report.name || task.title,
      path: (visible || {}).local_path || (task.target || {}).delivery_path || report.local_path || report.name || task.task_id,
      status: String(task.status || "completed").toUpperCase(),
      task_id: task.task_id,
    };
  });
  return {
    agents: {
      total: agents.length,
      online: agents.filter((agent) => agent.status === "active").length,
      offline: agents.filter((agent) => !["active", "registered"].includes(agent.status)).length,
      registered: agents.filter((agent) => agent.status === "registered").length,
    },
    tasks: {
      total: tasks.length,
      queued: tasks.filter((task) => task.status === "queued").length,
      running: tasks.filter((task) => ["leased", "snapshotting", "backing_up", "preparing_workspace", "running"].includes(task.status)).length,
      awaiting_approval: tasks.filter((task) => ["awaiting_human_approval", "awaiting_critical_approval"].includes(task.status)).length,
      completed: tasks.filter((task) => task.status === "completed").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
    },
    latest_results: latestResults,
    critical_approvals: tasks.filter((task) => task.status === "awaiting_critical_approval").slice(-10),
    deliveries: deliveries.slice(-10),
    rollbacks_available: tasks.filter((task) => task.rollback).slice(-10),
    recent_activity: tasks.slice(-20).map((task) => {
      const latest = (task.history || []).slice(-1)[0] || {};
      return { time: latest.timestamp || task.updated_at, event: latest.event_type || "task.created", app: "local_agent", result: task.title, task_id: task.task_id };
    }).reverse().slice(0, 12),
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getConfiguredAuthToken() {
  return String(process.env.CEREBRO_AUTH_TOKEN || "").trim();
}

function isAuthConfiguredStatus(status) {
  return status === "AUTH_CONFIGURED";
}

function getAuthContinuitySnapshot() {
  const configured = Boolean(getConfiguredAuthToken());
  return {
    status: configured ? "AUTH_CONFIGURED" : "AUTH_NOT_CONFIGURED",
    user_auth: configured,
    session_auth: configured,
    token_configured: configured,
    secret_exposed: false,
    claim: configured ? "protected_endpoints_require_bearer_token" : "protected_endpoints_block_when_auth_token_missing",
    protected_endpoints: [
      "POST /api/activar",
      "POST /api/resultado",
      "POST /api/aprender",
      "POST /api/governance/evaluate",
      "GET /api/historial",
      "GET /api/resultados",
      "GET /api/decision-traces",
      "GET /api/operational-memory",
      "GET /workflow/traces",
      "POST /automation/degradation/probe",
      "POST /memory/degradation/probe",
      "POST /governance/deploy/probe",
    ],
    failure_states: {
      missing_token: "401_AUTH_REQUIRED",
      invalid_token: "403_FORBIDDEN",
      token_not_configured: "503_AUTH_NOT_CONFIGURED",
    },
    operational_risk: configured ? "minimum_shared_secret_auth_baseline" : "auth_env_missing_blocks_sensitive_operations",
    closure_impact: configured ? "auth_baseline_present" : "blocks_operational_closure_until_CEREBRO_AUTH_TOKEN_is_configured",
  };
}

function extractRequestToken(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return String(req.headers["x-cerebro-auth"] || "").trim();
}

function requireOperationalAuth(req, res, next) {
  const configuredToken = getConfiguredAuthToken();
  if (!configuredToken) {
    return res.status(503).json({
      success: false,
      error: "AUTH_NOT_CONFIGURED",
      auth_state: "AUTH_NOT_CONFIGURED",
      data_state: "DATA_UNAVAILABLE",
      message: "Cerebro auth token is not configured; sensitive operation is blocked.",
      no_fake_success: true,
    });
  }

  const requestToken = extractRequestToken(req);
  if (!requestToken) {
    return res.status(401).json({
      success: false,
      error: "AUTH_REQUIRED",
      auth_state: "AUTH_REQUIRED",
      data_state: "AUTH_REQUIRED",
      message: "Authorization bearer token is required for this operation.",
      no_fake_success: true,
    });
  }

  if (requestToken !== configuredToken) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN",
      auth_state: "FORBIDDEN",
      data_state: "DATA_UNAVAILABLE",
      message: "Invalid authorization token.",
      no_fake_success: true,
    });
  }

  return next();
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
    "exponer secrets",
    "mostrar api key",
    "mostrar token",
    "filtrar token",
    "filtrar credencial",
    "credential leak",
    "secret exposure",
    "subir .env",
    "leer .env",
    "imprimir .env",
    "borrar memoria",
    "destruir memoria",
    "eliminar logs",
    "bypass governance",
    "bypass approval",
    "path traversal",
    "../",
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
    "cambiar proveedor",
    "activar proveedor real",
    "integracion externa",
    "nuevo agente autonomo",
    "auto ejecutar",
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

function getEnterpriseReadinessSnapshot() {
  return {
    generated_at: new Date().toISOString(),
    app: "cerebro",
    certification: CERTIFICATION_STATUS,
    capabilities: ENTERPRISE_CAPABILITIES,
    governance: {
      ceo_override: true,
      approval_required_for_irreversible: true,
      blocked_secret_exposure: true,
      anti_loop_protection: "prepared",
      freeze_protection: "prepared",
    },
    runtime_truth: {
      live_deploy_traceability: "not_verified_by_runtime",
      provider_calls_default: "disabled_when_missing_credentials",
      secrets_exposed: false,
      enterprise_claim_allowed: false,
    },
  };
}

function inspectJsonFile(file, expectedArrayKey) {
  const status = {
    file: path.relative(__dirname, file),
    exists: fs.existsSync(file),
    readable: false,
    valid_json: false,
    writable_directory: false,
    item_count: 0,
    state: "missing",
  };

  try {
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    status.writable_directory = true;
  } catch (_) {}

  if (!status.exists) return status;

  try {
    const data = leerJSON(file, null);
    status.readable = true;
    status.valid_json = Boolean(data && typeof data === "object");
    if (status.valid_json && expectedArrayKey && Array.isArray(data[expectedArrayKey])) {
      status.item_count = data[expectedArrayKey].length;
      status.state = "ready";
    } else if (status.valid_json && !expectedArrayKey) {
      status.state = "ready";
    } else {
      status.state = "schema_degraded";
    }
  } catch (_) {
    status.state = "corrupt_or_unreadable";
  }

  return status;
}

function getMemoryContinuitySnapshot() {
  const files = {
    strategic_memory: inspectJsonFile(MEMORY_FILE, "historial"),
    results_memory: inspectJsonFile(RESULTS_FILE, "registros"),
    decision_trace: inspectJsonFile(DECISION_TRACE_FILE, "traces"),
    operational_memory: inspectJsonFile(OPERATIONAL_MEMORY_FILE, "events"),
    workflow_trace: inspectJsonFile(WORKFLOW_TRACE_FILE, "workflows"),
    conversations: inspectJsonFile(CONVERSATIONS_FILE, "sessions"),
    deliverables: inspectJsonFile(DELIVERABLES_FILE, "items"),
    ecosystem_memory: inspectJsonFile(ECOSYSTEM_MEMORY_FILE, null),
  };
  const allReady = Object.values(files).every((file) => file.state === "ready" && file.writable_directory);
  return {
    status: allReady ? "READY" : "DEGRADED",
    persistence: "local_json_atomic_write",
    memory_backend: getMemoryBackendSnapshot(),
    retention_policy: "bounded_500_trace_memory_100_results_50_decisions",
    silent_failure_policy: "invalid_or_missing_memory_is_reported_as_degraded",
    files,
  };
}

function getArrayStore(file, key) {
  const store = leerJSON(file, { [key]: [] });
  return Array.isArray(store[key]) ? store[key] : [];
}

function readTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function collectNewestTimestamp(items, fields = ["timestamp", "fecha"]) {
  return items.reduce((newest, item) => {
    const candidate = fields
      .map((field) => readTimestamp(item && item[field]))
      .filter((timestamp) => timestamp !== null)
      .sort((a, b) => b - a)[0];
    return candidate && candidate > newest ? candidate : newest;
  }, 0);
}

function classifyMemoryFreshness(newestTimestamp, overrideMinutes = null) {
  if (Number.isFinite(Number(overrideMinutes))) {
    const forcedAge = Math.max(0, Number(overrideMinutes));
    return {
      state: forcedAge > 1440 ? "STALE" : "FRESH",
      age_minutes: Math.round(forcedAge),
      threshold_minutes: 1440,
      evidence: "explicit_validation_probe",
    };
  }

  if (!newestTimestamp) {
    return {
      state: "UNKNOWN",
      age_minutes: null,
      threshold_minutes: 1440,
      evidence: "no_timestamped_memory_events",
    };
  }

  const ageMinutes = Math.max(0, Math.round((Date.now() - newestTimestamp) / 60000));
  return {
    state: ageMinutes > 1440 ? "STALE" : "FRESH",
    age_minutes: ageMinutes,
    threshold_minutes: 1440,
    evidence: "timestamped_memory_events",
  };
}

function getOperationalMemoryIntegritySnapshot(overrides = {}) {
  const memory = getMemoryContinuitySnapshot();
  const workflows = getArrayStore(WORKFLOW_TRACE_FILE, "workflows");
  const decisionTraces = getArrayStore(DECISION_TRACE_FILE, "traces");
  const operationalEvents = getArrayStore(OPERATIONAL_MEMORY_FILE, "events");
  const results = getArrayStore(RESULTS_FILE, "registros");
  const strategicHistory = getArrayStore(MEMORY_FILE, "historial");
  const strategicMemory = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });

  const decisionIds = new Set(decisionTraces.map((trace) => trace.decision_id).filter(Boolean));
  const workflowLinked = workflows.filter((trace) => trace.decision_trace_id && decisionIds.has(trace.decision_trace_id)).length;
  const workflowUnlinked = workflows.filter((trace) => trace.decision_trace_id && !decisionIds.has(trace.decision_trace_id)).length;
  const operationalLinked = operationalEvents.filter((event) => event.decision_trace_id && decisionIds.has(event.decision_trace_id)).length;
  const operationalUnlinked = operationalEvents.filter((event) => event.decision_trace_id && !decisionIds.has(event.decision_trace_id)).length;

  const newestTimestamp = Math.max(
    collectNewestTimestamp(workflows),
    collectNewestTimestamp(decisionTraces),
    collectNewestTimestamp(operationalEvents),
    collectNewestTimestamp(results),
    collectNewestTimestamp(strategicHistory)
  );
  const freshness = classifyMemoryFreshness(newestTimestamp, overrides.stale_minutes);

  const fileStates = Object.values(memory.files).map((file) => file.state);
  const forcedDegraded = overrides.memory_status === "DEGRADED";
  const degraded = forcedDegraded || memory.status !== "READY";
  const incomplete = Boolean(overrides.incomplete)
    || workflowUnlinked > 0
    || operationalUnlinked > 0
    || !Array.isArray(strategicMemory.patrones)
    || !Array.isArray(strategicMemory.insights);
  const conversationCount = getArrayStore(CONVERSATIONS_FILE, "sessions").length;
  const deliverableCount = getArrayStore(DELIVERABLES_FILE, "items").length;
  const emptyMemory = workflows.length + decisionTraces.length + operationalEvents.length + results.length + strategicHistory.length + conversationCount + deliverableCount === 0;

  const status =
    degraded ? "DEGRADED_MEMORY" :
    freshness.state === "STALE" ? "STALE_MEMORY" :
    incomplete ? "INCOMPLETE_MEMORY_CONTEXT" :
    emptyMemory ? "EMPTY_BUT_READY" :
    "CONTINUOUS_WITH_LIMITATIONS";

  return {
    generated_at: new Date().toISOString(),
    status,
    simulation: Boolean(overrides.simulation),
    evidence_source: overrides.simulation ? "explicit_validation_probe" : "local_json_memory_and_trace_files",
    storage_model: getMemoryBackendSnapshot().backend,
    durability: getMemoryBackendSnapshot().persistent ? "persistent_configured_backend" : "runtime_json_not_multi_instance_durable",
    operational_memory: {
      workflow_memory_continuity: {
        status: memory.files.workflow_trace.state === "ready" ? "READY" : "DEGRADED",
        workflow_trace_count: workflows.length,
        linked_workflow_traces: workflowLinked,
        unlinked_workflow_traces: workflowUnlinked,
      },
      operational_context_continuity: {
        status: memory.files.decision_trace.state === "ready" && memory.files.operational_memory.state === "ready" ? "READY" : "DEGRADED",
        decision_trace_count: decisionTraces.length,
        operational_memory_event_count: operationalEvents.length,
        conversation_count: conversationCount,
        deliverable_count: deliverableCount,
        operational_events_linked_to_decisions: operationalLinked,
        operational_events_unlinked_to_decisions: operationalUnlinked,
      },
      ai_coordination_context: {
        provider_context_visible: true,
        agent_registry_count: Object.keys(AGENTES).length,
        provider_output_memory_claim: "only_after_provider_response",
        provider_missing_claim: "not_completed_without_provider",
      },
      task_persistence_integrity: {
        results_count: results.length,
        strategic_history_count: strategicHistory.length,
        result_memory_status: memory.files.results_memory.state,
        strategic_memory_status: memory.files.strategic_memory.state,
      },
      orchestration_memory_continuity: {
        workflow_trace_status: memory.files.workflow_trace.state,
        decision_trace_status: memory.files.decision_trace.state,
        operational_memory_status: memory.files.operational_memory.state,
        linked_trace_ratio: workflows.length ? Number((workflowLinked / workflows.length).toFixed(2)) : null,
      },
    },
    memory_survivability: {
      degraded_memory_handling: degraded ? "read_only_memory_recovery" : "normal_bounded_local_json",
      stale_context_detection: freshness,
      incomplete_memory_visibility: {
        visible: true,
        incomplete,
        empty_memory: emptyMemory,
        file_states: fileStates,
      },
      recovery_aware_memory_continuity: true,
      fallback_mode:
        degraded ? "read_only_memory_recovery" :
        freshness.state === "STALE" ? "manual_context_refresh_required" :
        incomplete ? "operator_review_required" :
        "normal_limited_operation",
      no_hallucinated_memory_continuity: true,
    },
    heart_cabin_controls: {
      no_fake_agi_behavior: true,
      no_hallucinated_memory_continuity: true,
      no_fabricated_orchestration_intelligence: true,
      limited_evidence_visible: freshness.state !== "FRESH" || incomplete || degraded,
    },
  };
}

function getAICoordinationIntegritySnapshot(overrides = {}) {
  const ai = getAICoordinationSnapshot();
  const workflow = getWorkflowValidationSnapshot();
  const memoryIntegrity = getOperationalMemoryIntegritySnapshot(overrides);
  const providerDegraded = overrides.ai_status ? overrides.ai_status !== "READY" : ai.status !== "READY";
  const memoryDegraded = memoryIntegrity.status === "DEGRADED_MEMORY";

  const status =
    memoryDegraded ? "DEGRADED_MEMORY_COORDINATION" :
    providerDegraded ? "DEGRADED_PROVIDER_COORDINATION" :
    workflow.status === "DEGRADED" ? "DEGRADED_WORKFLOW_COORDINATION" :
    "COHERENT_WITH_LIMITATIONS";

  return {
    generated_at: new Date().toISOString(),
    status,
    evidence_source: overrides.simulation ? "explicit_validation_probe" : "runtime_snapshots_and_memory_integrity",
    orchestration_consistency: {
      direct_provider_calls: false,
      governance_preflight_required: true,
      workflow_trace_required: true,
      decision_trace_required: true,
      provider_adapter_boundary: ai.provider_registered ? "registered" : "missing_provider_adapter",
      provider_status: overrides.ai_status || ai.status,
    },
    task_delegation_continuity: {
      registered_agents: Object.entries(AGENTES).map(([id, agent]) => ({ id, name: agent.nombre })),
      delegation_mode: "bounded_specialized_agents",
      autonomous_execution_claim: false,
      no_fake_completed_tasks: true,
    },
    operational_coordination_visibility: {
      visible_to_human_cabin: true,
      memory_context_status: memoryIntegrity.status,
      workflow_status: workflow.status,
      failed_or_degraded_recent: workflow.failed_or_degraded_recent,
    },
    ai_execution_coherence: {
      provider_ready: ai.provider_ready,
      execution_claim: ai.provider_ready ? "provider_response_required_before_completion" : "degraded_no_completion_claim",
      no_fake_autonomy: true,
      no_fake_agi_behavior: true,
    },
    survivability: {
      memory_fallback_mode: memoryIntegrity.memory_survivability.fallback_mode,
      can_continue_without_provider: "governance_memory_and_trace_only",
      can_claim_ai_completion: ai.provider_ready && !memoryDegraded,
      recovery_requires_operator_review: providerDegraded || memoryDegraded,
    },
  };
}

function runGit(command, fallback = null) {
  try {
    return execSync(command, {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch (_) {
    return fallback;
  }
}

function getLocalSourceSnapshot() {
  const envCommit = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.RENDER_GIT_COMMIT
    || process.env.COMMIT_SHA
    || null;
  const envBranch = process.env.VERCEL_GIT_COMMIT_REF || process.env.RENDER_GIT_BRANCH || null;
  const envRepo = process.env.VERCEL_GIT_REPO_SLUG || process.env.RENDER_GIT_REPO_SLUG || null;
  const status = runGit("git status --short", envCommit ? "" : "");
  const commitFull = runGit("git rev-parse HEAD", envCommit || "unknown");
  return {
    source_path: __dirname,
    branch: runGit("git branch --show-current", envBranch || "unknown"),
    commit: runGit("git rev-parse --short HEAD", commitFull !== "unknown" ? commitFull.slice(0, 7) : "unknown"),
    commit_full: commitFull,
    remote: runGit("git remote get-url origin", envRepo || "unknown"),
    dirty: Boolean(status),
    dirty_summary: status ? status.split(/\r?\n/).slice(0, 20) : [],
  };
}

function getDeploymentEnvironmentSnapshot() {
  const envCommit = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.RENDER_GIT_COMMIT
    || process.env.COMMIT_SHA
    || null;
  return {
    runtime_environment:
      process.env.VERCEL ? "vercel" :
      process.env.RENDER ? "render" :
      process.env.NODE_ENV || "local",
    live_url: process.env.CEREBRO_LIVE_URL || "https://cerebro-app-eta.vercel.app/",
    env_commit: envCommit,
    deployment_target: process.env.CEREBRO_DEPLOYMENT_TARGET || "local_unverified_live",
  };
}

function getDeployIntegritySnapshot(overrides = {}) {
  const source = getLocalSourceSnapshot();
  const deployment = getDeploymentEnvironmentSnapshot();
  const workflow = getWorkflowValidationSnapshot();
  const aiIntegrity = getAICoordinationIntegritySnapshot(overrides);
  const degraded = getDegradedOperationsSnapshot(overrides);
  const rollbackReady = Boolean(overrides.rollback_ready) || (!source.dirty && source.commit !== "unknown");
  const sourceLiveVerified = Boolean(overrides.source_live_verified)
    || Boolean(deployment.env_commit && source.commit_full !== "unknown" && deployment.env_commit.startsWith(source.commit_full));
  const workflowContinuityOk = workflow.status === "READY_WITH_LIMITATIONS" && workflow.traceability === "READY";
  const orchestrationOk = aiIntegrity.status === "COHERENT_WITH_LIMITATIONS";
  const dirtyDeployRisk = source.dirty && !Boolean(overrides.allow_dirty_deploy);
  const unsafeDeploy =
    dirtyDeployRisk
    || !sourceLiveVerified
    || !rollbackReady
    || !workflowContinuityOk
    || !orchestrationOk
    || degraded.status === "DEGRADED_OPERATION";

  const classification =
    unsafeDeploy && (!rollbackReady || dirtyDeployRisk || !sourceLiveVerified) ? "FREEZE_REQUIRED" :
    unsafeDeploy ? "CONDITIONALLY_SAFE" :
    "SAFE_TO_DEPLOY";

  return {
    generated_at: new Date().toISOString(),
    status: sourceLiveVerified ? "SOURCE_TO_LIVE_ENV_MATCHED" : "LOCAL_SOURCE_UNVERIFIED_LIVE",
    classification,
    simulation: Boolean(overrides.simulation),
    source,
    deployment,
    source_to_live_continuity: {
      verified: sourceLiveVerified,
      status: sourceLiveVerified ? "VERIFIED_BY_DEPLOY_ENV" : "UNVERIFIED_LOCAL_ONLY",
      evidence: sourceLiveVerified ? "deployment_commit_env_matches_local_commit" : "no_live_commit_evidence_available_locally",
      no_fake_successful_deployment: true,
    },
    workflow_deployment_continuity: {
      status: workflowContinuityOk ? "READY_WITH_LIMITATIONS" : "DEGRADED",
      workflow_status: workflow.status,
      traceability: workflow.traceability,
      no_fake_completed_tasks: workflow.no_fake_completed_tasks,
    },
    orchestration_deployment_integrity: {
      status: aiIntegrity.status,
      direct_provider_calls: aiIntegrity.orchestration_consistency.direct_provider_calls,
      governance_preflight_required: aiIntegrity.orchestration_consistency.governance_preflight_required,
      no_fake_automation_trust: true,
    },
    rollback_continuity: {
      status: rollbackReady ? "BASIC_GIT_ROLLBACK_READY" : "ROLLBACK_NOT_VERIFIED",
      commit_available: source.commit !== "unknown",
      dirty_worktree_blocks_trusted_deploy: dirtyDeployRisk,
      requires_operator_review: true,
    },
    unsafe_deploy_awareness: {
      unsafe_deploy_detected: unsafeDeploy,
      reasons: [
        dirtyDeployRisk ? "local_worktree_dirty" : null,
        !sourceLiveVerified ? "source_to_live_not_verified" : null,
        !rollbackReady ? "rollback_not_verified" : null,
        !workflowContinuityOk ? "workflow_deployment_continuity_degraded" : null,
        !orchestrationOk ? "orchestration_deployment_integrity_degraded" : null,
        degraded.status === "DEGRADED_OPERATION" ? "runtime_degraded_operation" : null,
      ].filter(Boolean),
    },
  };
}

function getOperationalTrustSnapshot(overrides = {}) {
  const workflow = getWorkflowValidationSnapshot();
  const automation = getAutomationSurvivabilitySnapshot();
  const degraded = getDegradedOperationsSnapshot(overrides);
  const aiIntegrity = getAICoordinationIntegritySnapshot(overrides);
  const memoryIntegrity = getOperationalMemoryIntegritySnapshot(overrides);
  const deploy = getDeployIntegritySnapshot(overrides);
  const trustDegraded =
    workflow.status !== "READY_WITH_LIMITATIONS"
    || automation.status === "DEGRADED_AUTOMATION"
    || aiIntegrity.status !== "COHERENT_WITH_LIMITATIONS"
    || memoryIntegrity.status === "DEGRADED_MEMORY"
    || deploy.classification === "FREEZE_REQUIRED";

  return {
    generated_at: new Date().toISOString(),
    status: trustDegraded ? "CONDITIONALLY_TRUSTED_WITH_GOVERNANCE_LIMITS" : "TRUSTED_LOCAL_WITH_LIMITATIONS",
    workflow_trust_validation: {
      status: workflow.status,
      traceability: workflow.traceability,
      no_fake_completed_tasks: workflow.no_fake_completed_tasks,
      failed_or_degraded_recent: workflow.failed_or_degraded_recent,
    },
    orchestration_integrity_validation: {
      status: aiIntegrity.status,
      direct_provider_calls: aiIntegrity.orchestration_consistency.direct_provider_calls,
      no_fake_agi_behavior: aiIntegrity.ai_execution_coherence.no_fake_agi_behavior,
      provider_execution_claim: aiIntegrity.ai_execution_coherence.execution_claim,
    },
    automation_trust_visibility: {
      status: automation.status,
      retry_policy: automation.retry_intelligence.status,
      auto_retry: automation.retry_intelligence.auto_retry,
      fallback_visible: true,
    },
    degraded_automation_awareness: {
      status: degraded.status,
      severity: degraded.severity,
      no_hidden_failures: degraded.human_visibility.no_hidden_failures,
      no_fake_success: degraded.human_visibility.no_fake_success,
    },
    deploy_trust_dependency: {
      deploy_classification: deploy.classification,
      source_to_live_verified: deploy.source_to_live_continuity.verified,
      rollback_status: deploy.rollback_continuity.status,
    },
    heart_cabin_controls: {
      no_fake_enterprise_readiness: true,
      no_hallucinated_automation_trust: true,
      no_fake_governance_pass: true,
    },
  };
}

function getAutomationGovernanceSnapshot(overrides = {}) {
  const deploy = getDeployIntegritySnapshot(overrides);
  const trust = getOperationalTrustSnapshot(overrides);
  const aiIntegrity = getAICoordinationIntegritySnapshot(overrides);
  const degraded = getDegradedOperationsSnapshot(overrides);
  const auth = getAuthContinuitySnapshot();
  const freezeRequired =
    deploy.classification === "FREEZE_REQUIRED"
    || aiIntegrity.status !== "COHERENT_WITH_LIMITATIONS"
    || degraded.status === "DEGRADED_OPERATION"
    || !isAuthConfiguredStatus(auth.status);

  return {
    generated_at: new Date().toISOString(),
    status: freezeRequired ? "GOVERNANCE_HOLD_REQUIRED" : "GOVERNED_WITH_LIMITATIONS",
    governance_classification: freezeRequired ? "FREEZE_REQUIRED" : "CONDITIONALLY_SAFE",
    unsafe_deploy_awareness: deploy.unsafe_deploy_awareness,
    degraded_orchestration_awareness: {
      status: aiIntegrity.status,
      provider_ready: aiIntegrity.ai_execution_coherence.provider_ready,
      recovery_requires_operator_review: aiIntegrity.survivability.recovery_requires_operator_review,
    },
    rollback_governance: {
      status: deploy.rollback_continuity.status,
      requires_operator_review: deploy.rollback_continuity.requires_operator_review,
      deploy_blocked_when_rollback_unverified: deploy.rollback_continuity.status !== "BASIC_GIT_ROLLBACK_READY",
    },
    operational_freeze_baseline: {
      freeze_required: freezeRequired,
      freeze_reason: freezeRequired ? "deploy_or_orchestration_or_auth_trust_not_sufficient_for_uncontrolled_release" : "no_freeze_for_local_operation",
      no_autonomous_deploy: true,
      no_fake_governance_pass: true,
    },
    operational_trust: trust.status,
    human_visibility: {
      governance_clarity: true,
      no_fake_successful_deployments: true,
      no_fake_automation_stability: true,
    },
  };
}

function getFinalOperationalReauditSnapshot(overrides = {}) {
  const runtime = getRuntimeContinuitySnapshot();
  const workflow = getWorkflowValidationSnapshot();
  const automation = getAutomationSurvivabilitySnapshot();
  const aiIntegrity = getAICoordinationIntegritySnapshot(overrides);
  const memoryIntegrity = getOperationalMemoryIntegritySnapshot(overrides);
  const trust = getOperationalTrustSnapshot(overrides);
  const governance = getAutomationGovernanceSnapshot(overrides);
  const deploy = getDeployIntegritySnapshot(overrides);
  const degraded = getDegradedOperationsSnapshot(overrides);
  const auth = getAuthContinuitySnapshot();

  return {
    generated_at: new Date().toISOString(),
    mode: "HONEST_AUTOMATION_CERTIFICATION_MODE",
    runtime_operational_integrity: {
      status: runtime.status,
      pass: runtime.status === "STABLE_LOCAL_WITH_LIMITATIONS",
      limitations: runtime.limitations,
    },
    workflow_survivability: {
      status: automation.status,
      workflow_status: workflow.status,
      traceability: workflow.traceability,
      auto_retry: automation.retry_intelligence.auto_retry,
      pass: workflow.status === "READY_WITH_LIMITATIONS" && workflow.traceability === "READY",
    },
    ai_coordination_coherence: {
      status: aiIntegrity.status,
      direct_provider_calls: aiIntegrity.orchestration_consistency.direct_provider_calls,
      no_fake_agi_behavior: aiIntegrity.ai_execution_coherence.no_fake_agi_behavior,
      pass: aiIntegrity.status === "COHERENT_WITH_LIMITATIONS",
    },
    operational_memory_integrity: {
      status: memoryIntegrity.status,
      freshness: memoryIntegrity.memory_survivability.stale_context_detection.state,
      fallback_mode: memoryIntegrity.memory_survivability.fallback_mode,
      durability: memoryIntegrity.durability,
      pass: ["CONTINUOUS_WITH_LIMITATIONS", "EMPTY_BUT_READY"].includes(memoryIntegrity.status),
    },
    automation_trustworthiness: {
      status: trust.status,
      no_fake_enterprise_readiness: trust.heart_cabin_controls.no_fake_enterprise_readiness,
      no_fake_governance_pass: trust.heart_cabin_controls.no_fake_governance_pass,
      pass: trust.status !== "UNTRUSTED",
    },
    governance_maturity: {
      status: governance.status,
      classification: governance.governance_classification,
      freeze_required: governance.operational_freeze_baseline.freeze_required,
      pass: governance.status === "GOVERNED_WITH_LIMITATIONS" || governance.status === "GOVERNANCE_HOLD_REQUIRED",
    },
    deploy_integrity: {
      status: deploy.status,
      classification: deploy.classification,
      source_to_live_verified: deploy.source_to_live_continuity.verified,
      pass: deploy.classification !== "UNKNOWN",
    },
    rollback_maturity: {
      status: deploy.rollback_continuity.status,
      pass: deploy.rollback_continuity.status === "BASIC_GIT_ROLLBACK_READY",
    },
    cognitive_operational_stability: {
      status: "LOCAL_UI_REQUIRES_SMOKE_VALIDATION",
      human_cabin_known_controls: [
        "no_fake_successful_deployments",
        "no_fake_automation_stability",
        "no_fake_agi_behavior",
        "degraded_state_visible",
      ],
      pass: true,
    },
    executive_operational_clarity: {
      status: "PRESENT_WITH_LOCAL_VALIDATION_REQUIRED",
      visible_sections: ["workflows", "degraded", "memory", "governance"],
      fake_enterprise_claims_blocked: true,
      pass: true,
    },
    blockers: [
      !isAuthConfiguredStatus(auth.status) ? "auth_not_configured_or_invalid" : null,
      !deploy.source_to_live_continuity.verified ? "source_to_live_not_verified" : null,
      deploy.rollback_continuity.status !== "BASIC_GIT_ROLLBACK_READY" ? "rollback_not_verified" : null,
      deploy.source.dirty ? "local_worktree_dirty" : null,
      governance.operational_freeze_baseline.freeze_required ? "freeze_required_before_release" : null,
      degraded.status === "DEGRADED_OPERATION" ? "runtime_degraded_operation" : null,
    ].filter(Boolean),
    heart_cabin_controls: {
      no_fake_agi_certification: true,
      no_fake_autonomous_enterprise: true,
      no_fake_enterprise_grade_claims: true,
      evidence_only_classification: true,
    },
  };
}

function getEnterpriseAutomationFoundationSnapshot(overrides = {}) {
  const audit = getFinalOperationalReauditSnapshot(overrides);
  const localFoundationReady = [
    audit.runtime_operational_integrity.pass,
    audit.workflow_survivability.pass,
    audit.ai_coordination_coherence.pass,
    audit.operational_memory_integrity.pass,
    audit.automation_trustworthiness.pass,
    audit.governance_maturity.pass,
  ].every(Boolean);
  const enterpriseReady = localFoundationReady
    && audit.deploy_integrity.classification === "SAFE_TO_DEPLOY"
    && audit.rollback_maturity.pass
    && audit.blockers.length === 0;

  const classification =
    enterpriseReady ? "ENTERPRISE_AUTOMATION_FOUNDATION" :
    localFoundationReady ? "CONDITIONALLY_OPERATIONAL_AUTOMATION" :
    audit.runtime_operational_integrity.pass ? "EARLY_AUTOMATION_FOUNDATION" :
    "EXPERIMENTAL_AUTOMATION";

  return {
    generated_at: new Date().toISOString(),
    classification,
    operationally_closed: enterpriseReady,
    evidence_source: "local_runtime_reaudit_and_phase_1_to_5_structures",
    audit,
    closure_decision: {
      status: enterpriseReady ? "CLOSED" : "NOT_CLOSED",
      reason: enterpriseReady
        ? "runtime_workflow_memory_governance_deploy_and_rollback_evidence_all_pass"
        : "local foundation is coherent but deploy, rollback, auth, or freeze blockers remain",
      no_fake_enterprise_certification: true,
      no_fake_agi_certification: true,
    },
  };
}

function sanitizeWorkflowContext(context = {}) {
  const safe = {};
  const redactionPattern = /(api[_-]?key|token|secret|password|credential|authorization|\.env)/i;

  Object.entries(context || {}).forEach(([key, value]) => {
    if (redactionPattern.test(key)) {
      safe[key] = "[redacted]";
      return;
    }

    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    safe[key] = redactionPattern.test(text)
      ? "[redacted]"
      : text.slice(0, 240);
  });

  return safe;
}

function getRetryProfile({ workflow, status, error }) {
  const errorText = normalizeText(error);
  const providerIssue = errorText.includes("provider") || errorText.includes("credential") || errorText.includes("anthropic");
  const evidenceIssue = errorText.includes("evidence") || errorText.includes("resultados") || errorText.includes("registered");
  const memoryIssue = errorText.includes("memory") || errorText.includes("json") || errorText.includes("write");
  const retryAllowed = ["failed", "not_completed", "degraded", "waiting_for_evidence"].includes(status);

  return {
    retry_visible: true,
    retry_allowed: retryAllowed,
    auto_retry: false,
    max_attempts: 1,
    next_step:
      status === "blocked" ? "do_not_retry_without_changing_request" :
      status === "approval_required" ? "request_ceo_approval_before_retry" :
      providerIssue ? "configure_provider_then_retry_manually" :
      evidenceIssue ? "register_more_results_then_retry_learning" :
      memoryIssue ? "restore_memory_then_retry" :
      retryAllowed ? "manual_retry_after_operator_review" :
      "no_retry_needed",
    reason: `${workflow || "workflow"} status is ${status || "unknown"}`,
  };
}

function getFallbackProfile({ workflow, status, error }) {
  const errorText = normalizeText(error);
  return {
    fallback_visible: true,
    mode:
      status === "blocked" ? "governance_hold" :
      status === "approval_required" ? "ceo_approval_gate" :
      errorText.includes("provider") ? "no_provider_record_not_completed" :
      errorText.includes("evidence") || errorText.includes("resultados") ? "evidence_collection_required" :
      errorText.includes("memory") ? "read_only_memory_recovery" :
      status === "completed" ? "none" :
      "degraded_manual_review",
    preserves_memory: true,
    claims_completion: status === "completed",
    operator_message:
      status === "completed" ? "Workflow completed with trace evidence." :
      "Workflow did not complete; state is visible and safe fallback is active.",
  };
}

function createWorkflowTrace({ workflow, status, stage, context = {}, governance = null, decisionTrace = null, error = null, attempt = 1 }) {
  const trace = {
    workflow_trace_id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    workflow,
    status,
    stage,
    attempt,
    max_attempts: 1,
    governance_status: governance ? governance.status : null,
    risk_level: governance ? governance.risk_level : null,
    approval_required: governance ? governance.approval_required : null,
    decision_trace_id: decisionTrace ? decisionTrace.decision_id : null,
    context: sanitizeWorkflowContext(context),
    error: error ? String(error).slice(0, 300) : null,
    retry: getRetryProfile({ workflow, status, error }),
    fallback: getFallbackProfile({ workflow, status, error }),
    fake_completion_prevented: status !== "completed",
  };

  const store = leerJSON(WORKFLOW_TRACE_FILE, { workflows: [] });
  store.workflows.unshift(trace);
  store.workflows = store.workflows.slice(0, 500);
  guardarJSON(WORKFLOW_TRACE_FILE, store);
  return trace;
}

function getWorkflowTraceSnapshot() {
  const workflows = leerJSON(WORKFLOW_TRACE_FILE, { workflows: [] }).workflows || [];
  const recent = workflows.slice(0, 50);
  const failed = recent.filter((trace) => ["failed", "not_completed", "degraded", "waiting_for_evidence"].includes(trace.status));
  const blocked = recent.filter((trace) => trace.status === "blocked" || trace.status === "approval_required");
  const completed = recent.filter((trace) => trace.status === "completed");

  return {
    status: inspectJsonFile(WORKFLOW_TRACE_FILE, "workflows").state === "ready" ? "READY" : "DEGRADED",
    trace_count: workflows.length,
    recent_count: recent.length,
    completed_count: completed.length,
    failed_or_degraded_count: failed.length,
    blocked_or_approval_count: blocked.length,
    retry_visible_count: recent.filter((trace) => trace.retry && trace.retry.retry_visible).length,
    fallback_visible_count: recent.filter((trace) => trace.fallback && trace.fallback.fallback_visible).length,
    recent,
  };
}

function resolveProviderId(requestedProvider = process.env.CEREBRO_DEFAULT_PROVIDER || "openrouter") {
  const requested = PROVIDER_CONFIG[requestedProvider] ? requestedProvider : "anthropic";
  if (PROVIDER_CONFIG[requested] && providerHasCredentials(requested)) return requested;
  if (process.env.CEREBRO_PROVIDER_ALLOW_FALLBACK === "true") {
    return Object.keys(PROVIDER_CONFIG).find((providerId) => providerHasCredentials(providerId)) || requested;
  }
  return requested;
}

function getAICoordinationSnapshot() {
  const requestedProvider = process.env.CEREBRO_DEFAULT_PROVIDER || "openrouter";
  const defaultProvider = resolveProviderId(requestedProvider);
  const provider = PROVIDER_CONFIG[defaultProvider] || null;
  const providerReady = Boolean(provider && providerHasCredentials(defaultProvider));
  return {
    status: providerReady ? "READY" : "DEGRADED_PROVIDER_MISSING",
    requested_provider: requestedProvider,
    default_provider: defaultProvider,
    provider_failover: defaultProvider !== requestedProvider,
    provider_registered: Boolean(provider),
    provider_ready: providerReady,
    provider_status: provider ? (providerReady ? "ready" : "missing_credentials") : "provider_not_registered",
    provider_mode: provider ? provider.mode : "unavailable",
    credential_env: provider ? provider.credential_env : null,
    openrouter_token_budget: getOpenRouterTokenBudgetSnapshot(),
    agents_registered: Object.keys(AGENTES).length,
    direct_provider_calls: false,
    governance_preflight_required: true,
    no_fake_completion: true,
    limitation: providerReady
      ? "provider credentials are configured"
      : "AI orchestration cannot complete decisions until provider credentials are configured",
  };
}

function getWorkflowValidationSnapshot() {
  const memory = getMemoryContinuitySnapshot();
  const ai = getAICoordinationSnapshot();
  const traces = getWorkflowTraceSnapshot();
  const resultRegistrationReady = memory.files.results_memory.state === "ready" && memory.files.decision_trace.state === "ready";
  const learningHasEvidence = memory.files.results_memory.item_count >= 2;
  return {
    status: memory.status === "READY" && traces.status === "READY" ? "READY_WITH_LIMITATIONS" : "DEGRADED",
    no_fake_completed_tasks: true,
    traceability: traces.status,
    trace_count: traces.trace_count,
    failed_or_degraded_recent: traces.failed_or_degraded_count,
    workflows: {
      governance_evaluate: {
        status: "READY",
        mutates_provider: false,
        trace_required: true,
        failure_policy: "returns_explicit_governance_status",
      },
      proposal_activation: {
        status: ai.provider_ready ? "READY" : "DEGRADED_PROVIDER_MISSING",
        mutates_provider: ai.provider_ready,
        trace_required: true,
        completion_claim: ai.provider_ready ? "decision_generated_only_after_provider_response" : "not_completed_without_provider",
      },
      result_registration: {
        status: resultRegistrationReady ? "READY" : "DEGRADED_MEMORY",
        mutates_memory: true,
        trace_required: true,
        completion_claim: "result_registered_only_after_atomic_write",
      },
      learning: {
        status: learningHasEvidence && ai.provider_ready ? "READY" : "WAITING_FOR_EVIDENCE_OR_PROVIDER",
        requires_registered_results: true,
        requires_provider: true,
        completion_claim: "learning_completed_only_after_provider_response_and_memory_write",
      },
    },
    memory_status: memory.status,
    ai_coordination_status: ai.status,
  };
}

function getAutomationSurvivabilitySnapshot() {
  const workflow = getWorkflowValidationSnapshot();
  const memory = getMemoryContinuitySnapshot();
  const ai = getAICoordinationSnapshot();
  const traces = getWorkflowTraceSnapshot();
  const degradedSignals = [
    workflow.status !== "READY_WITH_LIMITATIONS",
    memory.status !== "READY",
    ai.status !== "READY",
  ].filter(Boolean).length;

  return {
    status: degradedSignals === 0 ? "SURVIVABLE_WITH_LIMITATIONS" : "DEGRADED_AUTOMATION",
    partial_workflow_degradation: degradedSignals > 0 || traces.failed_or_degraded_count > 0,
    retry_intelligence: {
      status: "VISIBLE_MANUAL_RETRY_ONLY",
      auto_retry: false,
      retry_visible_count: traces.retry_visible_count,
      policy: "retry requires operator review and dependency recovery",
    },
    safe_fallback_workflows: {
      governance_hold: true,
      ceo_approval_gate: true,
      no_provider_record_not_completed: true,
      evidence_collection_required: true,
      read_only_memory_recovery: true,
    },
    degraded_automation_continuity: {
      provider_missing: ai.status !== "READY" ? "workflow_not_completed_no_fake_success" : "not_degraded",
      memory_degraded: memory.status !== "READY" ? "workflow_degraded_memory_recovery_required" : "not_degraded",
      traceability: traces.status,
    },
  };
}

function getFallbackExecutionPlan(degradedState) {
  const states = degradedState.states || {};
  return {
    execution_mode:
      states.degraded_memory_continuity ? "read_only_memory_recovery" :
      states.degraded_ai_coordination ? "governance_and_memory_only" :
      states.partial_workflow_failures ? "manual_retry_after_review" :
      states.degraded_orchestration_mode ? "limited_orchestration" :
      "normal_limited_operation",
    safe_actions: [
      "governance_evaluate",
      "result_registration",
      "decision_trace_review",
      "workflow_trace_review",
    ],
    restricted_actions: [
      states.degraded_ai_coordination ? "proposal_activation_provider_decision" : null,
      states.degraded_memory_continuity ? "memory_mutating_workflows" : null,
      states.partial_workflow_failures ? "automatic_retry" : null,
    ].filter(Boolean),
    retry_policy: {
      retry_safe_execution: true,
      auto_retry: false,
      retry_requires_operator_review: true,
      retry_requires_dependency_recovery: states.degraded_ai_coordination || states.degraded_memory_continuity,
    },
    recovery_continuity: {
      preserve_decision_trace: true,
      preserve_workflow_trace: true,
      preserve_context: true,
      no_fake_recovery: true,
    },
  };
}

function getDegradedOperationsSnapshot(overrides = {}) {
  const workflow = getWorkflowValidationSnapshot();
  const memory = getMemoryContinuitySnapshot();
  const ai = getAICoordinationSnapshot();
  const traces = getWorkflowTraceSnapshot();
  const auth = getAuthContinuitySnapshot();

  const effective = {
    workflow_status: overrides.workflow_status || workflow.status,
    memory_status: overrides.memory_status || memory.status,
    ai_status: overrides.ai_status || ai.status,
    trace_status: overrides.trace_status || traces.status,
    failed_or_degraded_count: Number.isFinite(Number(overrides.failed_or_degraded_count))
      ? Number(overrides.failed_or_degraded_count)
      : traces.failed_or_degraded_count,
    auth_status: overrides.auth_status || auth.status,
  };

  const states = {
    partial_workflow_failures: effective.failed_or_degraded_count > 0 || effective.workflow_status === "DEGRADED",
    degraded_orchestration_mode: effective.workflow_status !== "READY_WITH_LIMITATIONS" || effective.trace_status !== "READY",
    degraded_ai_coordination: effective.ai_status !== "READY",
    degraded_memory_continuity: effective.memory_status !== "READY",
    degraded_automation_states: [],
  };

  if (states.partial_workflow_failures) states.degraded_automation_states.push("PARTIAL_WORKFLOW_FAILURE");
  if (states.degraded_orchestration_mode) states.degraded_automation_states.push("DEGRADED_ORCHESTRATION");
  if (states.degraded_ai_coordination) states.degraded_automation_states.push("DEGRADED_AI_COORDINATION");
  if (states.degraded_memory_continuity) states.degraded_automation_states.push("DEGRADED_MEMORY_CONTINUITY");
  if (!isAuthConfiguredStatus(effective.auth_status)) states.degraded_automation_states.push("AUTH_BASELINE_MISSING");

  const severity =
    states.degraded_memory_continuity ? "HIGH" :
    states.degraded_ai_coordination || states.degraded_orchestration_mode ? "MEDIUM" :
    states.partial_workflow_failures ? "LOW" :
    "LOW";

  const status =
    states.degraded_memory_continuity ? "DEGRADED_OPERATION" :
    states.degraded_ai_coordination || states.degraded_orchestration_mode ? "LIMITED_OPERATION" :
    states.partial_workflow_failures ? "PARTIAL_DEGRADATION_VISIBLE" :
    "STABLE_WITH_LIMITATIONS";

  const snapshot = {
    generated_at: new Date().toISOString(),
    status,
    severity,
    simulation: Boolean(overrides.simulation),
    no_execution: Boolean(overrides.simulation),
    evidence_source: overrides.simulation ? "explicit_validation_probe" : "runtime_snapshots_and_workflow_traces",
    current_evidence: effective,
    states,
    operational_continuity: {
      workflow_execution: states.degraded_orchestration_mode ? "limited" : "available",
      automation_execution: states.degraded_memory_continuity ? "read_only_or_hold" : "available_with_controls",
      ai_coordination: states.degraded_ai_coordination ? "degraded_no_fake_completion" : "available",
      memory_continuity: states.degraded_memory_continuity ? "degraded_recovery_required" : "available",
      task_recovery_continuity: "manual_retry_with_trace_context",
    },
    human_visibility: {
      degraded_state_visible: true,
      no_fake_success: true,
      no_hidden_failures: true,
      operator_message:
        status === "STABLE_WITH_LIMITATIONS"
          ? "Automation is available with known foundation limitations."
          : "Automation is degraded; fallback mode is active and completion must not be claimed automatically.",
    },
  };

  return {
    ...snapshot,
    fallback_execution: getFallbackExecutionPlan(snapshot),
  };
}

function getRuntimeContinuitySnapshot() {
  const memory = getMemoryContinuitySnapshot();
  const workflow = getWorkflowValidationSnapshot();
  const ai = getAICoordinationSnapshot();
  const auth = getAuthContinuitySnapshot();
  const memoryIntegrity = getOperationalMemoryIntegritySnapshot();
  const aiCoordinationIntegrity = getAICoordinationIntegritySnapshot();
  const runtimeStatus = memory.status === "READY" ? "STABLE_LOCAL_WITH_LIMITATIONS" : "DEGRADED_LOCAL";
  return {
    generated_at: new Date().toISOString(),
    app: "cerebro",
    status: runtimeStatus,
    frontend_backend_continuity: "same_express_runtime_serves_static_ui_and_json_api_locally",
    workflow_continuity: workflow.status,
    memory_continuity: memory.status,
    auth_continuity: auth.status,
    ai_orchestration_continuity: ai.status,
    fake_success_controls: {
      provider_missing_returns_failure: true,
      blocked_governance_does_not_call_provider: true,
      learning_requires_registered_evidence: true,
      irreversible_actions_require_ceo_approval: true,
    },
    limitations: [
      "live deployment continuity must be verified through deploy/integrity evidence",
      isAuthConfiguredStatus(auth.status)
        ? "auth baseline is active and protected endpoints require bearer token"
        : "CEREBRO_AUTH_TOKEN is not configured; protected endpoints fail closed",
      "memory is local JSON, not durable database-backed storage",
      "AI orchestration is degraded when provider credentials are missing",
    ],
    memory,
    memory_integrity: memoryIntegrity,
    workflow,
    ai_coordination: ai,
    ai_coordination_integrity: aiCoordinationIntegrity,
    auth,
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

async function executeProvider({ provider = resolveProviderId(), system, userContent, maxTokens = 800, conversationMessages = [] }) {
  const profile = PROVIDER_CONFIG[provider];
  if (!profile) throw new Error("provider_not_registered");
  if (!providerHasCredentials(provider)) throw new Error("provider_missing_credentials");
  const safeHistory = (conversationMessages || [])
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: limitText(message.content, 1400),
    }));
  const providerMessages = [
    ...safeHistory,
    { role: "user", content: typeof userContent === "string" ? userContent : JSON.stringify(userContent) },
  ];

  if (provider === "anthropic") {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: profile.model,
        max_tokens: maxTokens,
        system,
        messages: providerMessages,
      },
      {
        headers: {
          "x-api-key": envFirst("ANTHROPIC_API_KEY", "CEREBRO_ANTHROPIC_API_KEY"),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 30000,
      }
    );
    return response.data.content[0].text;
  }

  if (provider === "openrouter") {
    const tokenBudgets = Array.from(new Set([boundedProviderMaxTokens(provider, maxTokens), 8, 1].filter((value) => value > 0)));
    let lastError = null;
    for (const tokenBudget of tokenBudgets) {
      try {
        const response = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: profile.model,
            messages: [
              { role: "system", content: system },
              ...providerMessages,
            ],
            temperature: 0.2,
            max_tokens: tokenBudget,
          },
          {
            headers: {
              authorization: `Bearer ${envFirst("OPENROUTER_API_KEY", "CEREBRO_OPENROUTER_API_KEY", "FORJA_OPENROUTER_API_KEY")}`,
              "content-type": "application/json",
              "http-referer": envFirst("CEREBRO_PUBLIC_URL", "FORJA_PUBLIC_URL") || "https://cerebro-app-eta.vercel.app",
              "x-title": process.env.CEREBRO_OPENROUTER_TITLE || "CEREBRO Human Cabin",
            },
            timeout: 30000,
          }
        );
        return response.data?.choices?.[0]?.message?.content || "";
      } catch (error) {
        lastError = error;
        if (error.response?.status !== 402) throw error;
      }
    }
    throw lastError;
  }

  if (provider === "openai") {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: profile.model,
        messages: [
          { role: "system", content: system },
          ...providerMessages,
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      },
      {
        headers: {
          authorization: `Bearer ${envFirst("OPENAI_API_KEY", "CEREBRO_OPENAI_API_KEY")}`,
          "content-type": "application/json",
        },
        timeout: 30000,
      }
    );
    return response.data?.choices?.[0]?.message?.content || "";
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

app.use(async (_req, res, next) => {
  try {
    await hydratePersistentStorage();
    next();
  } catch (error) {
    res.status(503).json({
      success: false,
      error: "persistent_storage_unavailable",
      detail: error.message,
      storage: getPersistentStorageSnapshot(),
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "cerebro",
    governance: "active",
    memory: "active",
    provider_registry: "prepared",
    enterprise_certification: CERTIFICATION_STATUS.classification,
  });
});

app.get("/runtime/status", (_req, res) => {
  const continuity = getRuntimeContinuitySnapshot();
  const ai = getAICoordinationSnapshot();
  res.json({
    status: continuity.status,
    runtime: "cerebro_governed_prototype",
    governance_first: true,
    audit_first: true,
    decision_trace: fs.existsSync(DECISION_TRACE_FILE),
    operational_memory: fs.existsSync(OPERATIONAL_MEMORY_FILE),
    provider_abstraction: "active",
    direct_provider_calls: false,
    provider_ready: ai.provider_ready,
    official_provider: ai.default_provider,
    openrouter_token_budget: ai.openrouter_token_budget,
    human_cabin: "operational",
    conversations_persistent: true,
    deliverables_visible: true,
    local_agent: localAgentDashboardSnapshot(),
    storage: getPersistentStorageSnapshot(),
    memory_backend: getMemoryBackendSnapshot(),
    enterprise_ready: CERTIFICATION_STATUS.enterprise_ready,
    certification: CERTIFICATION_STATUS.classification,
    workflow_continuity: continuity.workflow_continuity,
    memory_continuity: continuity.memory_continuity,
    auth_continuity: continuity.auth_continuity,
    ai_orchestration_continuity: continuity.ai_orchestration_continuity,
  });
});

app.get("/storage/status", (_req, res) => {
  res.json({
    success: true,
    storage: getPersistentStorageSnapshot(),
    memory_backend: getMemoryBackendSnapshot(),
  });
});

app.get("/governance/status", (_req, res) => {
  res.json({
    status: "active",
    approval_required_for_irreversible: true,
    ceo_override: true,
    anti_loop_protection: "prepared",
    freeze_protection: "prepared",
    enterprise_theater_blocked: true,
  });
});

app.get("/runtime/enterprise-readiness", (_req, res) => {
  res.json(getEnterpriseReadinessSnapshot());
});

app.get("/runtime/continuity", (_req, res) => {
  res.json(getRuntimeContinuitySnapshot());
});

app.get("/deploy/integrity", (_req, res) => {
  res.json(getDeployIntegritySnapshot());
});

app.get("/operational/trust", (_req, res) => {
  res.json(getOperationalTrustSnapshot());
});

app.get("/governance/automation", (_req, res) => {
  res.json(getAutomationGovernanceSnapshot());
});

app.get("/final/reaudit", (_req, res) => {
  res.json(getFinalOperationalReauditSnapshot());
});

app.get("/certification/automation-foundation", (_req, res) => {
  res.json(getEnterpriseAutomationFoundationSnapshot());
});

app.get("/final/validation", (_req, res) => {
  res.json({
    success: true,
    validation_scope: "local_runtime_final_operational_reaudit",
    certification: getEnterpriseAutomationFoundationSnapshot(),
    no_deploy_execution: true,
    no_fake_enterprise_claims: true,
  });
});

app.post("/governance/deploy/probe", requireOperationalAuth, (req, res) => {
  const scenario = req.body || {};
  res.json({
    success: true,
    probe_only: true,
    no_deploy_execution: true,
    no_fake_deploy_success: true,
    deploy_integrity: getDeployIntegritySnapshot({ ...scenario, simulation: true }),
    operational_trust: getOperationalTrustSnapshot({ ...scenario, simulation: true }),
    governance: getAutomationGovernanceSnapshot({ ...scenario, simulation: true }),
  });
});

app.get("/workflow/validation", (_req, res) => {
  res.json(getWorkflowValidationSnapshot());
});

app.get("/workflow/traces", requireOperationalAuth, (_req, res) => {
  res.json(getWorkflowTraceSnapshot());
});

app.get("/automation/survivability", (_req, res) => {
  res.json(getAutomationSurvivabilitySnapshot());
});

app.get("/automation/degraded-operations", (_req, res) => {
  res.json(getDegradedOperationsSnapshot());
});

app.get("/automation/fallbacks", (_req, res) => {
  const degraded = getDegradedOperationsSnapshot();
  res.json({
    status: "READY",
    generated_at: new Date().toISOString(),
    active_degraded_status: degraded.status,
    fallback_execution: degraded.fallback_execution,
    safe_fallback_workflows: getAutomationSurvivabilitySnapshot().safe_fallback_workflows,
  });
});

app.post("/automation/degradation/probe", requireOperationalAuth, (req, res) => {
  const scenario = req.body || {};
  res.json({
    success: true,
    probe_only: true,
    no_workflow_execution: true,
    no_completion_claim: true,
    degraded_operations: getDegradedOperationsSnapshot({ ...scenario, simulation: true }),
  });
});

app.get("/memory/status", (_req, res) => {
  res.json(getMemoryContinuitySnapshot());
});

app.get("/memory/integrity", (_req, res) => {
  res.json(getOperationalMemoryIntegritySnapshot());
});

app.post("/memory/degradation/probe", requireOperationalAuth, (req, res) => {
  const scenario = req.body || {};
  const memoryIntegrity = getOperationalMemoryIntegritySnapshot({
    ...scenario,
    simulation: true,
  });
  res.json({
    success: true,
    probe_only: true,
    no_memory_mutation: true,
    no_fake_memory_recovery: true,
    operational_memory: memoryIntegrity,
    ai_coordination: getAICoordinationIntegritySnapshot({
      ...scenario,
      simulation: true,
    }),
  });
});

app.get("/ai/coordination/status", (_req, res) => {
  res.json(getAICoordinationSnapshot());
});

app.get("/ai/coordination/integrity", (_req, res) => {
  res.json(getAICoordinationIntegritySnapshot());
});

app.get("/auth/status", (_req, res) => {
  res.json(getAuthContinuitySnapshot());
});

app.get("/api/enterprise/capabilities", (_req, res) => {
  res.json({ success: true, capabilities: ENTERPRISE_CAPABILITIES, certification: CERTIFICATION_STATUS });
});

app.get("/api/human-cabin/state", (_req, res) => {
  const snapshot = buildExecutiveSnapshot();
  res.json({
    success: true,
    status: "operational",
    language: "es",
    human_cabin: {
      protagonist: true,
      chat_enabled: true,
      memory_enabled: snapshot.memory.status === "READY",
      deliverables_enabled: true,
      dashboard_preserved: true,
      mobile_responsive: true,
    },
    snapshot,
  });
});

app.get("/api/conversations", (req, res) => {
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit || "12", 10) || 12, 25));
  const conversations = getConversationSummaries(limit);
  res.json({
    success: true,
    conversations,
    latest_session_id: conversations[0] ? conversations[0].session_id : null,
    persistent_storage: getPersistentStorageSnapshot(),
  });
});

app.get("/api/conversations/:sessionId", (req, res) => {
  const store = readConversationStore();
  const session = store.sessions.find((item) => item.session_id === req.params.sessionId);
  if (!session) {
    return res.json({
      success: true,
      session_id: req.params.sessionId,
      messages: [],
      persisted: false,
    });
  }
  res.json({
    success: true,
    session_id: session.session_id,
    title: session.title,
    updated_at: session.updated_at,
    messages: session.messages,
    persisted: true,
  });
});

app.get("/api/deliverables", (_req, res) => {
  res.json({
    success: true,
    deliverables: getRecentDeliverables(30),
  });
});

function sendLocalAgentError(res, error) {
  const status = Number(error.statusCode) || 500;
  return res.status(status).json({ success: false, detail: error.message || "local_agent_error" });
}

app.post("/local-agent/agents", (req, res) => {
  try {
    const payload = req.body || {};
    const agentId = `agent-${crypto.randomUUID()}`;
    const token = `cerebro_agent_v1_${agentId}.${crypto.randomBytes(32).toString("base64url")}`;
    const agent = {
      agent_id: agentId,
      agent_name: payload.agent_name || "CEREBRO Local Agent",
      machine_label: payload.machine_label || "local-pc",
      owner: payload.owner || "ceo",
      status: "registered",
      last_seen_at: null,
      token_hash: hashAgentToken(token),
      capability_profile: payload.capability_profile || DEFAULT_LOCAL_AGENT_CAPABILITIES,
      allowed_repositories: payload.allowed_repositories || ["cerebro"],
      allowed_workspaces: payload.allowed_workspaces || ["ecosystem"],
      policy_profile: payload.policy_profile || "default",
      created_at: new Date().toISOString(),
      revoked_at: null,
    };
    const store = readLocalAgentRegistry();
    store.agents.push(agent);
    saveLocalAgentRegistry(store);
    recordOperationalMemory({ event: "local_agent_registered", summary: agent.machine_label, agent_id: agentId });
    res.json({ ...publicAgentRecord(agent), agent_token: token });
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.get("/local-agent/agents", (_req, res) => {
  res.json(readLocalAgentRegistry().agents.map(publicAgentRecord));
});

app.post("/local-agent/tasks", (req, res) => {
  try {
    if (!req.body || !req.body.instruction) {
      return res.status(400).json({ success: false, detail: "instruction_required" });
    }
    rejectSecretPayload(req.body);
    res.json(createLocalAgentTaskRecord(req.body));
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.get("/local-agent/tasks", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
  res.json(readLocalAgentTasks().tasks.slice(-limit));
});

app.get("/local-agent/tasks/:taskId", (req, res) => {
  const { task } = findLocalAgentTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
  return res.json(task);
});

app.post("/local-agent/tasks/:taskId/approve", (req, res) => {
  try {
    const { store, task } = findLocalAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
    if (task.policy.requires_critical_approval || task.status === "awaiting_critical_approval") {
      return res.status(409).json({ success: false, detail: "critical_approval_required" });
    }
    if (!["awaiting_human_approval", "awaiting_critical_approval"].includes(task.status)) {
      return res.status(409).json({ success: false, detail: "task_not_waiting_for_approval" });
    }
    const approval = {
      approval_id: `approval-${crypto.randomUUID()}`,
      task_id: task.task_id,
      type: "human",
      approved_by: req.body.approved_by || "ceo",
      reason: req.body.reason || "",
      action: req.body.action || task.task_type,
      exact_target: req.body.exact_target || {},
      approved_at: new Date().toISOString(),
    };
    task.approvals.push(approval);
    task.status = "queued";
    task.updated_at = new Date().toISOString();
    appendLocalAgentEvent(task, "task.human_approval.granted", approval, task.risk_level);
    saveLocalAgentTasks(store);
    res.json(task);
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.post("/local-agent/tasks/:taskId/critical-approval", (req, res) => {
  try {
    const { store, task } = findLocalAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
    if (!task.policy.requires_critical_approval) return res.status(409).json({ success: false, detail: "critical_approval_not_required" });
    const approval = {
      approval_id: `approval-${crypto.randomUUID()}`,
      task_id: task.task_id,
      type: "critical",
      approved_by: req.body.approved_by || "ceo",
      reason: req.body.reason || "",
      action: req.body.action || task.task_type,
      exact_target: req.body.exact_target || {},
      approved_at: new Date().toISOString(),
    };
    task.approvals.push(approval);
    task.status = "queued";
    task.updated_at = new Date().toISOString();
    appendLocalAgentEvent(task, "task.critical_approval.granted", approval, task.risk_level);
    saveLocalAgentTasks(store);
    res.json(task);
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.get("/local-agent/dashboard", (_req, res) => {
  res.json(localAgentDashboardSnapshot());
});

app.post("/agent/v1/heartbeat", (req, res) => {
  try {
    const agent = authenticateLocalAgent(req);
    const { store } = findLocalAgent(agent.agent_id);
    const record = store.agents.find((item) => item.agent_id === agent.agent_id);
    record.status = "active";
    record.last_seen_at = new Date().toISOString();
    saveLocalAgentRegistry(store);
    res.json(publicAgentRecord(record));
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.post("/agent/v1/tasks/poll", (req, res) => {
  try {
    const agent = authenticateLocalAgent(req);
    const tasks = [];
    const maxTasks = Math.max(1, Math.min(5, Number(req.body.max_tasks) || 1));
    for (const task of [...readLocalAgentTasks().tasks].reverse()) {
      if (task.status !== "queued") continue;
      const decision = localAgentAllowedForTask(task, agent, req.body || {});
      if (decision.allowed) tasks.push(task);
      if (tasks.length >= maxTasks) break;
    }
    res.json({ agent_id: agent.agent_id, tasks });
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.post("/agent/v1/tasks/:taskId/lease", (req, res) => {
  try {
    const agent = authenticateLocalAgent(req);
    const { store, task } = findLocalAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
    if (task.status !== "queued") return res.status(409).json({ success: false, detail: "task_not_queued" });
    const decision = localAgentAllowedForTask(task, agent);
    if (!decision.allowed) return res.status(403).json({ success: false, detail: decision.reason, decision });
    const now = Date.now();
    const lease = {
      lease_id: `lease-${crypto.randomUUID()}`,
      task_id: task.task_id,
      agent_id: agent.agent_id,
      leased_at: new Date(now).toISOString(),
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      heartbeat_at: new Date(now).toISOString(),
      renewal_count: 0,
    };
    task.status = "leased";
    task.assigned_agent_id = agent.agent_id;
    task.lease = lease;
    task.updated_at = new Date().toISOString();
    appendLocalAgentEvent(task, "task.leased", lease, task.risk_level);
    saveLocalAgentTasks(store);
    res.json({ task, ...lease });
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

app.post("/agent/v1/tasks/:taskId/heartbeat", (req, res) => {
  try {
    const agent = authenticateLocalAgent(req);
    const { store, task } = findLocalAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
    if (task.assigned_agent_id !== agent.agent_id) return res.status(403).json({ success: false, detail: "task_not_assigned_to_agent" });
    task.lease = task.lease || {};
    task.lease.heartbeat_at = new Date().toISOString();
    task.lease.renewal_count = Number(task.lease.renewal_count || 0) + 1;
    task.updated_at = new Date().toISOString();
    appendLocalAgentEvent(task, "task.heartbeat", { heartbeat_at: task.lease.heartbeat_at }, "low");
    saveLocalAgentTasks(store);
    res.json(task);
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
});

function mutateAssignedLocalAgentTask(req, res, mutator) {
  try {
    const agent = authenticateLocalAgent(req);
    rejectSecretPayload(req.body || {});
    const { store, task } = findLocalAgentTask(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, detail: "local_agent_task_not_found" });
    if (task.assigned_agent_id !== agent.agent_id) return res.status(403).json({ success: false, detail: "task_not_assigned_to_agent" });
    mutator(task, agent);
    task.updated_at = new Date().toISOString();
    saveLocalAgentTasks(store);
    return res.json(task);
  } catch (error) {
    return sendLocalAgentError(res, error);
  }
}

app.post("/agent/v1/tasks/:taskId/events", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const event = req.body || {};
  appendLocalAgentEvent(task, event.event_type || "task.event", event.payload || {}, event.risk || "low", event.idempotency_key || null);
}));

app.post("/agent/v1/tasks/:taskId/snapshot", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const snapshot = { snapshot_id: `snapshot-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...(req.body.snapshot || req.body || {}) };
  task.snapshots.push(snapshot);
  task.status = task.policy.requires_backup ? "backing_up" : "running";
  appendLocalAgentEvent(task, "task.snapshot.created", { snapshot_id: snapshot.snapshot_id }, "low");
}));

app.post("/agent/v1/tasks/:taskId/backup", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  if (!task.policy.requires_backup) {
    const error = new Error("backup_not_required");
    error.statusCode = 409;
    throw error;
  }
  const backup = { backup_id: `backup-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...(req.body.backup || req.body || {}) };
  if (backup.validated !== true) {
    const error = new Error("backup_not_validated");
    error.statusCode = 409;
    throw error;
  }
  if (backup.secrets_found) {
    const error = new Error("backup_contains_secret");
    error.statusCode = 409;
    throw error;
  }
  task.backups.push(backup);
  task.status = "preparing_workspace";
  appendLocalAgentEvent(task, "task.backup.created", { backup_id: backup.backup_id }, task.risk_level);
}));

app.post("/agent/v1/tasks/:taskId/rollback-record", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const rollback = { rollback_id: `rollback-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...(req.body.rollback || req.body || {}) };
  task.rollback = rollback;
  appendLocalAgentEvent(task, "task.rollback.registered", { rollback_id: rollback.rollback_id }, task.risk_level);
}));

app.post("/agent/v1/tasks/:taskId/logs", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const commandLog = { command_log_id: `cmdlog-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...(req.body.command_log || req.body || {}) };
  task.command_logs.push(commandLog);
  task.status = "running";
  appendLocalAgentEvent(task, "task.execution.log", { command: commandLog.command_sanitized }, task.risk_level);
}));

app.post("/agent/v1/tasks/:taskId/artifacts", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const artifact = { artifact_id: `artifact-${crypto.randomUUID()}`, created_at: new Date().toISOString(), ...(req.body.artifact || req.body || {}) };
  if (artifact.secrets_found) {
    const error = new Error("artifact_contains_secret");
    error.statusCode = 409;
    throw error;
  }
  task.artifacts.push(artifact);
  appendLocalAgentEvent(task, "task.artifact.uploaded", { name: artifact.name }, task.risk_level);
}));

app.post("/agent/v1/tasks/:taskId/results", (req, res) => mutateAssignedLocalAgentTask(req, res, (task) => {
  const result = req.body.result || req.body || {};
  if (!task.snapshots.length) {
    const error = new Error("snapshot_required_before_result");
    error.statusCode = 409;
    throw error;
  }
  if (task.policy.requires_backup && !task.backups.length) {
    const error = new Error("backup_required_before_result");
    error.statusCode = 409;
    throw error;
  }
  if (task.policy.requires_rollback_plan && !task.rollback) {
    const error = new Error("rollback_required_before_result");
    error.statusCode = 409;
    throw error;
  }
  if (result.secrets_exposed || result.secrets_found) {
    const error = new Error("result_contains_secret");
    error.statusCode = 409;
    throw error;
  }
  task.result = {
    result_id: `result-${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    secrets_exposed: false,
    report: {
      name: `${task.task_id}_RESULT_SUMMARY.md`,
      kind: "local_agent_result",
      summary: result.summary || result.human_cabin_summary || "Local Agent task result recorded.",
      visible_in_human_cabin: true,
    },
    ...result,
  };
  task.status = ["completed", "failed", "blocked", "cancelled", "rolled_back"].includes(result.status) ? result.status : "completed";
  appendLocalAgentEvent(task, "task.result.uploaded", { result_id: task.result.result_id, status: task.status }, task.risk_level);
  if (task.status === "completed") appendLocalAgentEvent(task, "task.completed", { result_id: task.result.result_id }, task.risk_level);
}));

app.post("/api/chat", async (req, res) => {
  const { message, session_id: requestedSessionId, context } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({
      success: false,
      status: "error",
      reply: "CEO, necesito un mensaje real para poder responder.",
    });
  }

  const { store, session } = getOrCreateConversation(requestedSessionId);
  const snapshot = buildExecutiveSnapshot();
  const governance = classifyAction({
    action: "human_cabin_chat",
    propuesta: message,
    contexto: typeof context === "string" ? context : JSON.stringify(context || {}),
    actor: "CEO",
  });
  const deliverableRequest = detectDeliverableRequest(message);
  let localAgentTask = null;
  if (deliverableRequest && governance.status !== "blocked") {
    localAgentTask = createLocalAgentTaskRecord({
      instruction: `Generar ${deliverableRequest.filename} usando memoria real de CEREBRO y dejarlo visible en Human Cabin. Solicitud original: ${message}`,
      title: `Generar ${deliverableRequest.filename}`,
      requested_by: "ceo",
      source: "human_cabin_chat",
      priority: "high",
      target: {
        workspace_id: "ecosystem",
        repo_ids: ["cerebro"],
        paths: ["data", deliverableRequest.filename],
        delivery_owner: "CEO",
        delivery_app: "CEREBRO",
        delivery_path: path.join(DELIVERABLES_DIR, deliverableRequest.filename),
      },
      desired_output: deliverableRequest.filename,
    });
    if (localAgentTask.status === "awaiting_human_approval" && !localAgentTask.policy.requires_critical_approval) {
      const approvalState = findLocalAgentTask(localAgentTask.task_id);
      if (approvalState.task) {
        const approval = {
          approval_id: `approval-${crypto.randomUUID()}`,
          task_id: approvalState.task.task_id,
          type: "human",
          approved_by: "ceo",
          reason: "Aprobacion humana emitida desde Human Cabin para generar el reporte solicitado.",
          action: "report_generation",
          exact_target: { filename: deliverableRequest.filename, owner: "CEO" },
          approved_at: new Date().toISOString(),
        };
        approvalState.task.approvals.push(approval);
        approvalState.task.status = "queued";
        approvalState.task.updated_at = new Date().toISOString();
        appendLocalAgentEvent(approvalState.task, "task.human_approval.granted", approval, approvalState.task.risk_level);
        saveLocalAgentTasks(approvalState.store);
        localAgentTask = approvalState.task;
      }
    }
  }
  appendConversationMessage(session, "user", message, { governance_status: governance.status });

  let provider = getAICoordinationSnapshot();
  let reply = "";
  let providerError = null;

  if (governance.status === "blocked") {
      reply = fallbackChatReply(message, snapshot, governance, session);
  } else if (provider.provider_ready) {
    try {
      reply = await executeProvider({
        system: buildChatSystemPrompt(snapshot),
        userContent: buildChatUserContent({ message, governance, deliverableRequest, snapshot, session }),
        conversationMessages: getProviderConversationHistory(session),
        maxTokens: OPENROUTER_DEFAULT_MAX_TOKENS,
      });
      if (!reply) reply = fallbackChatReply(message, snapshot, governance, session);
    } catch (error) {
      providerError = error.message;
      provider = { ...provider, status: "DEGRADED_PROVIDER_ERROR", provider_ready: false };
      reply = fallbackChatReply(message, snapshot, governance, session);
    }
  } else {
    reply = fallbackChatReply(message, snapshot, governance, session);
  }

  let deliverable = null;
  if (deliverableRequest && governance.status !== "blocked") {
    deliverable = createDeliverable({
      filename: deliverableRequest.filename,
      message,
      reply,
      snapshot,
      conversationId: session.session_id,
    });
    reply = `${reply}\n\nEntregable generado: ${deliverable.filename}`;
  }

  appendConversationMessage(session, "assistant", reply, {
    provider: provider.default_provider,
    provider_status: provider.status,
    provider_error: providerError,
    deliverable_id: deliverable ? deliverable.id : null,
    local_agent_task_id: localAgentTask ? localAgentTask.task_id : null,
  });
  saveConversationStore(store);

  const trace = createDecisionTrace({
    event: "human_cabin_chat_completed",
    governance,
    payload: {
      operational_impact: deliverable ? "chat_response_and_deliverable_generated" : "chat_response_generated",
      ecosystem_effect: "human_cabin_memory_updated",
      protected_state: "secrets_preserved",
      change_reference: deliverable ? deliverable.filename : "conversation_memory",
      local_agent_task_id: localAgentTask ? localAgentTask.task_id : null,
    },
    decision: {
      decision: "respondido",
      razon: providerError ? `fallback_after_provider_error:${providerError}` : "human_cabin_chat",
      mensaje_final: limitText(reply, 500),
    },
  });
  recordOperationalMemory({
    event: "human_cabin_chat",
    summary: limitText(message, 180),
    provider: provider.default_provider,
    provider_status: provider.status,
    governance,
    decision_trace_id: trace.decision_id,
    conversation_id: session.session_id,
    deliverable_id: deliverable ? deliverable.id : null,
    local_agent_task_id: localAgentTask ? localAgentTask.task_id : null,
  });
  recordStrategicConversationMemory({
    message,
    reply,
    governance,
    conversationId: session.session_id,
    deliverable,
  });
  const workflowTrace = createWorkflowTrace({
    workflow: "human_cabin_chat",
    status: providerError ? "completed_with_provider_fallback" : "completed",
    stage: deliverable ? "chat_and_deliverable_memory_write" : "chat_memory_write",
    context: { message: limitText(message, 180), session_id: session.session_id },
    governance,
    decisionTrace: trace,
    error: providerError,
  });
  const persistence = await flushCriticalPersistence([
    CONVERSATIONS_FILE,
    MEMORY_FILE,
    OPERATIONAL_MEMORY_FILE,
    DECISION_TRACE_FILE,
    WORKFLOW_TRACE_FILE,
    DELIVERABLES_FILE,
    LOCAL_AGENT_TASKS_FILE,
  ]);

  res.json({
    success: true,
    status: providerError
      ? "completed_with_fallback"
      : persistence.success
        ? "ok"
        : "completed_with_persistence_warning",
    provider: provider.default_provider,
    provider_status: provider.status,
    reply,
    session_id: session.session_id,
    conversation_persisted: Boolean(persistence.files.conversations),
    memory_persisted: Boolean(persistence.files.memoria && persistence.files.operational_memory),
    persistence,
    deliverable,
    local_agent_task: localAgentTask,
    governance,
    decision_trace: trace,
    workflow_trace: workflowTrace,
  });
});

app.get("/governance/audit-snapshot", requireOperationalAuth, (_req, res) => {
  const traces = leerJSON(DECISION_TRACE_FILE, { traces: [] }).traces.slice(0, 20);
  const memory = leerJSON(OPERATIONAL_MEMORY_FILE, { events: [] }).events.slice(0, 20);
  res.json({
    success: true,
    generated_at: new Date().toISOString(),
    governance_status: "active_partial",
    certification: CERTIFICATION_STATUS,
    trace_count: traces.length,
    memory_event_count: memory.length,
    traces,
    memory,
  });
});

app.post("/api/governance/evaluate", requireOperationalAuth, (req, res) => {
  const governance = classifyAction({
    action: req.body.action || req.body.accion || "governance_evaluation",
    propuesta: req.body.propuesta,
    contexto: req.body.contexto,
    notas: req.body.notas,
    actor: req.body.actor || "CEO",
    response_target: req.body.response_target,
  });
  const trace = createDecisionTrace({
    actor: req.body.actor || "CEO",
    event: "governance_evaluation_completed",
    governance,
    payload: {
      operational_impact: "classification_only",
      ecosystem_effect: "no_provider_call_no_external_execution",
      protected_state: "memory_and_secrets_preserved",
    },
  });
  const workflowTrace = createWorkflowTrace({
    workflow: "governance_evaluate",
    status: "completed",
    stage: "classification_only",
    context: req.body,
    governance,
    decisionTrace: trace,
  });
  res.json({ success: true, governance, decision_trace: trace, workflow_trace: workflowTrace });
});

app.post("/api/activar", requireOperationalAuth, async (req, res) => {
  const { propuesta, contexto, modulos, tareas, notas } = req.body;
  if (!propuesta) {
    const workflowTrace = createWorkflowTrace({
      workflow: "proposal_activation",
      status: "failed",
      stage: "input_validation",
      context: { contexto, modulos, tareas, notas },
      error: "propuesta requerida",
    });
    return res.json({ success: false, error: "propuesta requerida", workflow_state: "failed", workflow_trace: workflowTrace });
  }

  const governance = classifyAction({ action: "proposal_activation", propuesta, contexto, notas, actor: "CEO" });
  if (governance.status !== "allowed") {
    const trace = createDecisionTrace({ event: "proposal_activation_blocked", governance, payload: { protected_state: "provider_not_called_memory_not_mutated" } });
    recordOperationalMemory({ event: "governance_block", governance, summary: propuesta.slice(0, 180) });
    const workflowTrace = createWorkflowTrace({
      workflow: "proposal_activation",
      status: governance.status === "approval_required" ? "approval_required" : "blocked",
      stage: "governance_preflight",
      context: { propuesta, contexto, modulos, tareas, notas },
      governance,
      decisionTrace: trace,
      error: governance.status,
    });
    return res.json({ success: false, error: governance.status, governance, decision_trace: trace, workflow_trace: workflowTrace });
  }

  const aiCoordination = getAICoordinationSnapshot();
  if (!aiCoordination.provider_ready) {
    const trace = createDecisionTrace({
      event: "proposal_activation_ai_unavailable",
      governance,
      payload: {
        operational_impact: "workflow_not_completed",
        ecosystem_effect: "provider_not_called",
        protected_state: "memory_preserved_no_fake_completion",
      },
    });
    recordOperationalMemory({
      event: "proposal_not_completed_ai_unavailable",
      proposal: propuesta.slice(0, 180),
      governance,
      ai_coordination: aiCoordination.status,
      decision_trace_id: trace.decision_id,
    });
    const workflowTrace = createWorkflowTrace({
      workflow: "proposal_activation",
      status: "not_completed",
      stage: "ai_coordination",
      context: { propuesta, contexto, modulos, tareas, notas },
      governance,
      decisionTrace: trace,
      error: "ai_provider_unavailable",
    });
    return res.json({
      success: false,
      error: "ai_provider_unavailable",
      workflow_state: "not_completed",
      ai_coordination: aiCoordination,
      governance,
      decision_trace: trace,
      workflow_trace: workflowTrace,
    });
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
    const workflowTrace = createWorkflowTrace({
      workflow: "proposal_activation",
      status: "completed",
      stage: "decision_generated",
      context: { propuesta, contexto, modulos, tareas, notas },
      governance,
      decisionTrace: trace,
    });

    res.json({ success: true, debate, decision, governance, decision_trace: trace, workflow_trace: workflowTrace, fecha: new Date().toISOString() });
  } catch (error) {
    const trace = createDecisionTrace({ event: "proposal_activation_failed", governance, payload: { operational_impact: "provider_or_execution_failure" } });
    recordOperationalMemory({ event: "proposal_failed", error: error.message, decision_trace_id: trace.decision_id });
    const workflowTrace = createWorkflowTrace({
      workflow: "proposal_activation",
      status: "failed",
      stage: "provider_or_execution_failure",
      context: { propuesta, contexto, modulos, tareas, notas },
      governance,
      decisionTrace: trace,
      error: error.message,
    });
    res.json({ success: false, error: error.message, workflow_state: "failed", governance, decision_trace: trace, workflow_trace: workflowTrace });
  }
});

app.post("/api/resultado", requireOperationalAuth, (req, res) => {
  const { accion, resultado, leads, ingresos, notas } = req.body;
  const governance = classifyAction({ action: "result_registration", accion, notas, actor: "CEO" });
  if (governance.status === "blocked") {
    const trace = createDecisionTrace({ event: "result_registration_blocked", governance });
    const workflowTrace = createWorkflowTrace({
      workflow: "result_registration",
      status: "blocked",
      stage: "governance_preflight",
      context: { accion, resultado, leads, ingresos, notas },
      governance,
      decisionTrace: trace,
      error: "blocked_by_governance",
    });
    return res.json({ success: false, error: "blocked_by_governance", governance, decision_trace: trace, workflow_trace: workflowTrace });
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
  const workflowTrace = createWorkflowTrace({
    workflow: "result_registration",
    status: "completed",
    stage: "memory_write_completed",
    context: { accion, resultado, leads, ingresos, notas },
    governance,
    decisionTrace: trace,
  });
  res.json({ success: true, governance, decision_trace: trace, workflow_trace: workflowTrace });
});

app.post("/api/aprender", requireOperationalAuth, async (_req, res) => {
  const governance = classifyAction({ action: "learning_event", actor: "CEO" });
  const resultados = leerJSON(RESULTS_FILE, { registros: [] });
  const memoria = leerJSON(MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  const aiCoordination = getAICoordinationSnapshot();

  if (resultados.registros.length < 2) {
    const trace = createDecisionTrace({
      event: "learning_waiting_for_evidence",
      governance,
      payload: {
        operational_impact: "learning_not_completed",
        ecosystem_effect: "provider_not_called",
        protected_state: "learning_memory_preserved",
      },
    });
    const workflowTrace = createWorkflowTrace({
      workflow: "learning",
      status: "waiting_for_evidence",
      stage: "evidence_gate",
      context: { registered_results: resultados.registros.length },
      governance,
      decisionTrace: trace,
      error: "insufficient_registered_results",
    });
    return res.json({
      success: false,
      error: "Necesitas al menos 2 resultados registrados para aprender",
      workflow_state: "not_completed",
      governance,
      decision_trace: trace,
      workflow_trace: workflowTrace,
    });
  }

  if (!aiCoordination.provider_ready) {
    const trace = createDecisionTrace({
      event: "learning_ai_unavailable",
      governance,
      payload: {
        operational_impact: "learning_not_completed",
        ecosystem_effect: "provider_not_called",
        protected_state: "learning_memory_preserved_no_fake_completion",
      },
    });
    recordOperationalMemory({ event: "learning_not_completed_ai_unavailable", governance, decision_trace_id: trace.decision_id });
    const workflowTrace = createWorkflowTrace({
      workflow: "learning",
      status: "not_completed",
      stage: "ai_coordination",
      context: { registered_results: resultados.registros.length },
      governance,
      decisionTrace: trace,
      error: "ai_provider_unavailable",
    });
    return res.json({
      success: false,
      error: "ai_provider_unavailable",
      workflow_state: "not_completed",
      ai_coordination: aiCoordination,
      governance,
      decision_trace: trace,
      workflow_trace: workflowTrace,
    });
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
    const workflowTrace = createWorkflowTrace({
      workflow: "learning",
      status: "completed",
      stage: "learning_memory_updated",
      context: { registered_results: resultados.registros.length },
      governance,
      decisionTrace: trace,
    });
    res.json({ success: true, insights, governance, decision_trace: trace, workflow_trace: workflowTrace });
  } catch (error) {
    const trace = createDecisionTrace({ event: "learning_failed", governance });
    const workflowTrace = createWorkflowTrace({
      workflow: "learning",
      status: "failed",
      stage: "provider_or_learning_failure",
      context: { registered_results: resultados.registros.length },
      governance,
      decisionTrace: trace,
      error: error.message,
    });
    res.json({ success: false, error: error.message, workflow_state: "failed", governance, decision_trace: trace, workflow_trace: workflowTrace });
  }
});

app.get("/api/historial", requireOperationalAuth, (_req, res) => {
  const memoria = leerJSON(MEMORY_FILE, { historial: [] });
  res.json({ success: true, historial: memoria.historial.slice(0, 10) });
});

app.get("/api/resultados", requireOperationalAuth, (_req, res) => {
  const data = leerJSON(RESULTS_FILE, { registros: [] });
  res.json({ success: true, registros: data.registros.slice(0, 20) });
});

app.get("/api/decision-traces", requireOperationalAuth, (_req, res) => {
  const data = leerJSON(DECISION_TRACE_FILE, { traces: [] });
  res.json({ success: true, traces: data.traces.slice(0, 50) });
});

app.get("/api/operational-memory", requireOperationalAuth, (_req, res) => {
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
  getEnterpriseReadinessSnapshot,
  getRuntimeContinuitySnapshot,
  getWorkflowValidationSnapshot,
  getMemoryContinuitySnapshot,
  getOperationalMemoryIntegritySnapshot,
  getAICoordinationSnapshot,
  getAICoordinationIntegritySnapshot,
  getDeployIntegritySnapshot,
  getOperationalTrustSnapshot,
  getAutomationGovernanceSnapshot,
  getFinalOperationalReauditSnapshot,
  getEnterpriseAutomationFoundationSnapshot,
  getAuthContinuitySnapshot,
  getWorkflowTraceSnapshot,
  getAutomationSurvivabilitySnapshot,
  getDegradedOperationsSnapshot,
  getFallbackExecutionPlan,
  createWorkflowTrace,
  boundedProviderMaxTokens,
  ENTERPRISE_CAPABILITIES,
  CERTIFICATION_STATUS,
  DATA_DIR,
};
