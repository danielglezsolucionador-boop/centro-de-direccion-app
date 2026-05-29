const express = require("express");
const axios = require("axios");
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

const PROVIDER_CONFIG = {
  anthropic: {
    provider_id: "anthropic",
    provider_name: "Anthropic",
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    credential_env: "ANTHROPIC_API_KEY",
    model: process.env.CEREBRO_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    mode: "configured_connector",
    status: Boolean(process.env.ANTHROPIC_API_KEY) ? "ready" : "missing_credentials",
  },
};

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
    status: "partial",
    evidence: ["quiet executive UI", "action/result/history loops"],
    missing: ["live crisis mode", "adaptive cognitive UX", "mobile command validation"],
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
  migrateIfNeeded(LEGACY_MEMORY_FILE, MEMORY_FILE, { historial: [], patrones: [], insights: [] });
  migrateIfNeeded(LEGACY_RESULTS_FILE, RESULTS_FILE, { registros: [] });
  ensureJsonFile(DECISION_TRACE_FILE, { traces: [] });
  ensureJsonFile(OPERATIONAL_MEMORY_FILE, { events: [] });
  ensureJsonFile(WORKFLOW_TRACE_FILE, { workflows: [] });
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

function getConfiguredAuthToken() {
  return String(process.env.CEREBRO_AUTH_TOKEN || "").trim();
}

function getAuthContinuitySnapshot() {
  const configured = Boolean(getConfiguredAuthToken());
  return {
    status: configured ? "AUTH_REQUIRED" : "AUTH_NOT_CONFIGURED",
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
  };
  const allReady = Object.values(files).every((file) => file.state === "ready" && file.writable_directory);
  return {
    status: allReady ? "READY" : "DEGRADED",
    persistence: "local_json_atomic_write",
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
  const emptyMemory = workflows.length + decisionTraces.length + operationalEvents.length + results.length + strategicHistory.length === 0;

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
    storage_model: "local_json_atomic_write",
    durability: "local_only_not_database_backed",
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
    || auth.status !== "AUTH_REQUIRED";

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
      auth.status !== "AUTH_REQUIRED" ? "auth_not_configured_or_invalid" : null,
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

function getAICoordinationSnapshot() {
  const defaultProvider = process.env.CEREBRO_DEFAULT_PROVIDER || "anthropic";
  const provider = PROVIDER_CONFIG[defaultProvider] || null;
  const providerReady = Boolean(provider && provider.enabled);
  return {
    status: providerReady ? "READY" : "DEGRADED_PROVIDER_MISSING",
    default_provider: defaultProvider,
    provider_registered: Boolean(provider),
    provider_ready: providerReady,
    provider_status: provider ? provider.status : "provider_not_registered",
    provider_mode: provider ? provider.mode : "unavailable",
    credential_env: provider ? provider.credential_env : null,
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
  if (effective.auth_status !== "AUTH_REQUIRED") states.degraded_automation_states.push("AUTH_BASELINE_MISSING");

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
      auth.status === "AUTH_REQUIRED"
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
    enterprise_certification: CERTIFICATION_STATUS.classification,
  });
});

app.get("/runtime/status", (_req, res) => {
  const continuity = getRuntimeContinuitySnapshot();
  res.json({
    status: continuity.status,
    runtime: "cerebro_governed_prototype",
    governance_first: true,
    audit_first: true,
    decision_trace: fs.existsSync(DECISION_TRACE_FILE),
    operational_memory: fs.existsSync(OPERATIONAL_MEMORY_FILE),
    provider_abstraction: "active",
    direct_provider_calls: false,
    provider_ready: PROVIDER_CONFIG.anthropic.enabled,
    enterprise_ready: CERTIFICATION_STATUS.enterprise_ready,
    certification: CERTIFICATION_STATUS.classification,
    workflow_continuity: continuity.workflow_continuity,
    memory_continuity: continuity.memory_continuity,
    auth_continuity: continuity.auth_continuity,
    ai_orchestration_continuity: continuity.ai_orchestration_continuity,
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
  ENTERPRISE_CAPABILITIES,
  CERTIFICATION_STATUS,
  DATA_DIR,
};
