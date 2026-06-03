const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.env.CEREBRO_AUTH_TOKEN = process.env.CEREBRO_AUTH_TOKEN || "test-auth-token";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENROUTER_API_KEY = "";
process.env.CEREBRO_OPENROUTER_API_KEY = "";
process.env.FORJA_OPENROUTER_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const {
  classifyAction,
  app,
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
  boundedProviderMaxTokens,
} = require("../server");

async function request(method, path, body, options = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  const auth = options.auth === false
    ? null
    : typeof options.auth === "string"
      ? options.auth
      : process.env.CEREBRO_AUTH_TOKEN;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(options.headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  } finally {
    server.close();
  }
}

(async () => {
  const previousOpenRouterCap = process.env.CEREBRO_OPENROUTER_MAX_TOKENS;
  process.env.CEREBRO_OPENROUTER_MAX_TOKENS = "1";
  assert.strictEqual(boundedProviderMaxTokens("openrouter", 1300), 900);
  if (previousOpenRouterCap === undefined) delete process.env.CEREBRO_OPENROUTER_MAX_TOKENS;
  else process.env.CEREBRO_OPENROUTER_MAX_TOKENS = previousOpenRouterCap;

  const safe = classifyAction({ propuesta: "evaluar una oportunidad comercial reversible" });
  assert.strictEqual(safe.status, "allowed");
  assert.strictEqual(safe.approval_required, false);

  const approval = classifyAction({ propuesta: "hacer deploy a produccion y migrar base" });
  assert.strictEqual(approval.status, "approval_required");
  assert.strictEqual(approval.approval_required, true);

  const blocked = classifyAction({ propuesta: "subir .env y mostrar api key sin aprobacion" });
  assert.strictEqual(blocked.status, "blocked");

  const traversal = classifyAction({ propuesta: "usar path traversal ../ para leer .env" });
  assert.strictEqual(traversal.status, "blocked");

  const providerChange = classifyAction({ propuesta: "activar proveedor real y cambiar proveedor sin validacion" });
  assert.strictEqual(providerChange.status, "approval_required");

  const health = await request("GET", "/health");
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(health.governance, "active");
  assert.ok(health.enterprise_certification);

  const runtime = await request("GET", "/runtime/status");
  assert.strictEqual(runtime.governance_first, true);
  assert.strictEqual(runtime.direct_provider_calls, false);
  assert.strictEqual(runtime.enterprise_ready, false);
  assert.ok(runtime.workflow_continuity);
  assert.ok(runtime.memory_continuity);
  assert.ok(runtime.ai_orchestration_continuity);
  assert.ok(runtime.storage);
  assert.strictEqual(runtime.storage.uses_tmp_only, false);

  const storage = await request("GET", "/storage/status", null, { auth: false });
  assert.strictEqual(storage.success, true);
  assert.strictEqual(storage.storage.enabled, false);
  assert.ok(storage.storage.required_env.includes("KV_REST_API_URL"));

  const readiness = await request("GET", "/runtime/enterprise-readiness");
  assert.strictEqual(readiness.app, "cerebro");
  assert.strictEqual(readiness.certification.enterprise_ready, false);
  assert.strictEqual(readiness.runtime_truth.secrets_exposed, false);

  const capability = await request("GET", "/api/enterprise/capabilities");
  assert.strictEqual(capability.success, true);
  assert.strictEqual(capability.certification.enterprise_ready, false);

  const humanCabin = await request("GET", "/api/human-cabin/state", null, { auth: false });
  assert.strictEqual(humanCabin.success, true);
  assert.strictEqual(humanCabin.human_cabin.protagonist, true);
  assert.strictEqual(humanCabin.human_cabin.chat_enabled, true);
  assert.ok(Array.isArray(humanCabin.snapshot.apps));

  const chat = await request("POST", "/api/chat", {
    session_id: "test_human_cabin",
    message: "Hola CEREBRO, resume el ecosistema.",
  }, { auth: false });
  assert.strictEqual(chat.success, true);
  assert.strictEqual(chat.conversation_persisted, true);
  assert.ok(chat.reply.includes("CEO") || chat.reply.includes("ecosistema"));

  const deliverableChat = await request("POST", "/api/chat", {
    session_id: "test_human_cabin",
    message: "Genera un inventario de aplicaciones y guárdalo como ECOSYSTEM_APPS_REPORT.md",
  }, { auth: false });
  assert.strictEqual(deliverableChat.success, true);
  assert.ok(deliverableChat.deliverable);
  assert.strictEqual(deliverableChat.deliverable.filename, "ECOSYSTEM_APPS_REPORT.md");

  const conversation = await request("GET", "/api/conversations/test_human_cabin", null, { auth: false });
  assert.strictEqual(conversation.success, true);
  assert.ok(conversation.messages.length >= 2);

  const conversations = await request("GET", "/api/conversations?limit=1", null, { auth: false });
  assert.strictEqual(conversations.success, true);
  assert.ok(conversations.latest_session_id);
  assert.strictEqual(conversations.conversations.length, 1);

  await request("POST", "/api/chat", {
    session_id: "test_ceo_context",
    message: "Estamos corrigiendo CEREBRO.",
  }, { auth: false });
  const contextReply = await request("POST", "/api/chat", {
    session_id: "test_ceo_context",
    message: "Que estamos haciendo ahora?",
  }, { auth: false });
  assert.strictEqual(contextReply.success, true);
  assert.ok(contextReply.reply.includes("corrigiendo CEREBRO"));

  const deliverables = await request("GET", "/api/deliverables", null, { auth: false });
  assert.strictEqual(deliverables.success, true);
  assert.ok(deliverables.deliverables.some((item) => item.filename === "ECOSYSTEM_APPS_REPORT.md"));

  const agent = await request("POST", "/local-agent/agents", {
    agent_name: "CEREBRO Test Agent",
    machine_label: "test-pc",
    allowed_repositories: ["cerebro"],
  }, { auth: false });
  assert.ok(agent.agent_id);
  assert.ok(agent.agent_token);
  assert.strictEqual(agent.token_hash, undefined);

  const agentHeaders = {
    "x-cerebro-agent-id": agent.agent_id,
    authorization: `Bearer ${agent.agent_token}`,
  };
  const heartbeat = await request("POST", "/agent/v1/heartbeat", {}, { auth: false, headers: agentHeaders });
  assert.strictEqual(heartbeat.status, "active");

  const localTask = await request("POST", "/local-agent/tasks", {
    instruction: "Genera un inventario de aplicaciones y guárdalo como CEREBRO_AGENT_REPORT.md",
    title: "Generar CEREBRO_AGENT_REPORT.md",
    target: { workspace_id: "ecosystem", repo_ids: ["cerebro"], paths: ["data"] },
    desired_output: "CEREBRO_AGENT_REPORT.md",
  }, { auth: false });
  assert.strictEqual(localTask.task_type, "report_generation");
  assert.strictEqual(localTask.policy.requires_backup, true);

  const approvedTask = await request("POST", `/local-agent/tasks/${localTask.task_id}/approve`, {
    approved_by: "ceo",
    reason: "test approval",
  }, { auth: false });
  assert.strictEqual(approvedTask.status, "queued");

  const polled = await request("POST", "/agent/v1/tasks/poll", { max_tasks: 1 }, { auth: false, headers: agentHeaders });
  assert.ok(polled.tasks.some((item) => item.task_id === localTask.task_id));

  const leased = await request("POST", `/agent/v1/tasks/${localTask.task_id}/lease`, {}, { auth: false, headers: agentHeaders });
  assert.strictEqual(leased.task.status, "leased");

  const snapshotted = await request("POST", `/agent/v1/tasks/${localTask.task_id}/snapshot`, {
    snapshot: { git_status: "clean", files_scanned: 3 },
  }, { auth: false, headers: agentHeaders });
  assert.ok(snapshotted.snapshots.length >= 1);

  const backedUp = await request("POST", `/agent/v1/tasks/${localTask.task_id}/backup`, {
    backup: { path: "D:\\ECOSYSTEM\\BACKUPS\\test.zip", validated: true, secrets_found: false },
  }, { auth: false, headers: agentHeaders });
  assert.ok(backedUp.backups.length >= 1);

  const rollback = await request("POST", `/agent/v1/tasks/${localTask.task_id}/rollback-record`, {
    rollback: { plan: "restore backup", reversible: true },
  }, { auth: false, headers: agentHeaders });
  assert.ok(rollback.rollback);

  const artifact = await request("POST", `/agent/v1/tasks/${localTask.task_id}/artifacts`, {
    artifact: { name: "CEREBRO_AGENT_REPORT.md", local_path: "data/deliverables/CEREBRO_AGENT_REPORT.md", visible_in_human_cabin: true, secrets_found: false },
  }, { auth: false, headers: agentHeaders });
  assert.ok(artifact.artifacts.some((item) => item.visible_in_human_cabin));

  const completedTask = await request("POST", `/agent/v1/tasks/${localTask.task_id}/results`, {
    result: { status: "completed", summary: "test report generated", secrets_exposed: false },
  }, { auth: false, headers: agentHeaders });
  assert.strictEqual(completedTask.status, "completed");
  assert.ok(completedTask.result);

  const localAgentDashboard = await request("GET", "/local-agent/dashboard", null, { auth: false });
  assert.ok(localAgentDashboard.agents.total >= 1);
  assert.ok(localAgentDashboard.tasks.completed >= 1);

  const humanCabinAfterAgent = await request("GET", "/api/human-cabin/state", null, { auth: false });
  assert.ok(humanCabinAfterAgent.snapshot.local_agent.tasks.total >= 1);

  const humanCabinHtml = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.ok(humanCabinHtml.includes("Estoy listo para ayudarte a ordenar prioridades, detectar bloqueos y convertir decisiones en ejecuci"));
  assert.ok(humanCabinHtml.includes("id=\"voiceButton\""));
  assert.ok(humanCabinHtml.includes("SpeechRecognition"));

  const snapshot = getEnterpriseReadinessSnapshot();
  assert.strictEqual(snapshot.certification.strategic_authority_ready, false);

  const runtimeContinuity = await request("GET", "/runtime/continuity");
  assert.ok(runtimeContinuity.status);
  assert.strictEqual(runtimeContinuity.fake_success_controls.provider_missing_returns_failure, true);
  assert.strictEqual(runtimeContinuity.fake_success_controls.blocked_governance_does_not_call_provider, true);

  const workflow = await request("GET", "/workflow/validation");
  assert.strictEqual(workflow.no_fake_completed_tasks, true);
  assert.ok(workflow.workflows.proposal_activation.completion_claim);
  assert.ok(workflow.traceability);

  const memory = await request("GET", "/memory/status");
  assert.ok(memory.files.decision_trace.valid_json);
  assert.ok(memory.files.operational_memory.valid_json);
  assert.ok(memory.files.workflow_trace.valid_json);

  const memoryIntegrity = await request("GET", "/memory/integrity");
  assert.ok(memoryIntegrity.status);
  assert.strictEqual(memoryIntegrity.heart_cabin_controls.no_fake_agi_behavior, true);
  assert.strictEqual(memoryIntegrity.memory_survivability.no_hallucinated_memory_continuity, true);
  assert.ok(memoryIntegrity.operational_memory.workflow_memory_continuity);

  const ai = await request("GET", "/ai/coordination/status");
  assert.strictEqual(ai.direct_provider_calls, false);
  assert.strictEqual(ai.no_fake_completion, true);

  const aiIntegrity = await request("GET", "/ai/coordination/integrity");
  assert.ok(aiIntegrity.status);
  assert.strictEqual(aiIntegrity.orchestration_consistency.direct_provider_calls, false);
  assert.strictEqual(aiIntegrity.ai_execution_coherence.no_fake_agi_behavior, true);
  assert.strictEqual(aiIntegrity.task_delegation_continuity.autonomous_execution_claim, false);

  const deployIntegrity = await request("GET", "/deploy/integrity");
  assert.ok(deployIntegrity.classification);
  assert.strictEqual(deployIntegrity.source_to_live_continuity.no_fake_successful_deployment, true);
  assert.strictEqual(deployIntegrity.orchestration_deployment_integrity.direct_provider_calls, false);
  assert.ok(deployIntegrity.rollback_continuity.status);

  const operationalTrust = await request("GET", "/operational/trust");
  assert.ok(operationalTrust.status);
  assert.strictEqual(operationalTrust.heart_cabin_controls.no_fake_enterprise_readiness, true);
  assert.strictEqual(operationalTrust.heart_cabin_controls.no_fake_governance_pass, true);
  assert.strictEqual(operationalTrust.automation_trust_visibility.auto_retry, false);

  const automationGovernance = await request("GET", "/governance/automation");
  assert.ok(automationGovernance.status);
  assert.strictEqual(automationGovernance.operational_freeze_baseline.no_autonomous_deploy, true);
  assert.strictEqual(automationGovernance.operational_freeze_baseline.no_fake_governance_pass, true);
  assert.strictEqual(automationGovernance.human_visibility.no_fake_successful_deployments, true);

  const finalReaudit = await request("GET", "/final/reaudit");
  assert.ok(finalReaudit.runtime_operational_integrity.status);
  assert.strictEqual(finalReaudit.heart_cabin_controls.no_fake_agi_certification, true);
  assert.strictEqual(finalReaudit.heart_cabin_controls.no_fake_enterprise_grade_claims, true);
  assert.ok(Array.isArray(finalReaudit.blockers));

  const finalCertification = await request("GET", "/certification/automation-foundation");
  assert.ok([
    "EXPERIMENTAL_AUTOMATION",
    "EARLY_AUTOMATION_FOUNDATION",
    "CONDITIONALLY_OPERATIONAL_AUTOMATION",
    "ENTERPRISE_AUTOMATION_FOUNDATION",
  ].includes(finalCertification.classification));
  assert.strictEqual(finalCertification.operationally_closed, false);
  assert.strictEqual(finalCertification.closure_decision.no_fake_enterprise_certification, true);

  const finalValidation = await request("GET", "/final/validation");
  assert.strictEqual(finalValidation.success, true);
  assert.strictEqual(finalValidation.no_deploy_execution, true);
  assert.strictEqual(finalValidation.no_fake_enterprise_claims, true);

  const auth = await request("GET", "/auth/status");
  assert.strictEqual(auth.status, "AUTH_CONFIGURED");
  assert.strictEqual(auth.secret_exposed, false);
  assert.strictEqual(auth.claim, "protected_endpoints_require_bearer_token");
  assert.strictEqual(getAuthContinuitySnapshot().status, "AUTH_CONFIGURED");

  const unauthenticatedResult = await request("POST", "/api/resultado", {
    accion: "intento sin auth",
    resultado: "fallido",
  }, { auth: false });
  assert.strictEqual(unauthenticatedResult.success, false);
  assert.strictEqual(unauthenticatedResult.error, "AUTH_REQUIRED");
  assert.strictEqual(unauthenticatedResult.no_fake_success, true);

  const forbiddenResult = await request("POST", "/api/resultado", {
    accion: "intento token invalido",
    resultado: "fallido",
  }, { auth: "bad-token" });
  assert.strictEqual(forbiddenResult.success, false);
  assert.strictEqual(forbiddenResult.error, "FORBIDDEN");

  assert.ok(getRuntimeContinuitySnapshot().status);
  assert.ok(getWorkflowValidationSnapshot().workflows);
  assert.ok(getMemoryContinuitySnapshot().files);
  assert.ok(getOperationalMemoryIntegritySnapshot().status);
  assert.ok(getAICoordinationSnapshot().status);
  assert.ok(getAICoordinationIntegritySnapshot().status);
  assert.ok(getDeployIntegritySnapshot().classification);
  assert.ok(getOperationalTrustSnapshot().status);
  assert.ok(getAutomationGovernanceSnapshot().status);
  assert.ok(getFinalOperationalReauditSnapshot().runtime_operational_integrity);
  assert.ok(getEnterpriseAutomationFoundationSnapshot().classification);
  assert.ok(getWorkflowTraceSnapshot().status);
  assert.ok(getAutomationSurvivabilitySnapshot().status);
  assert.ok(getDegradedOperationsSnapshot().status);

  const blockedActivation = await request("POST", "/api/activar", {
    propuesta: "subir .env y mostrar api key sin aprobacion",
  });
  assert.strictEqual(blockedActivation.success, false);
  assert.strictEqual(blockedActivation.governance.status, "blocked");
  assert.strictEqual(blockedActivation.workflow_trace.status, "blocked");
  assert.strictEqual(blockedActivation.workflow_trace.fallback.mode, "governance_hold");

  const result = await request("POST", "/api/resultado", {
    accion: "registrar resultado comercial reversible",
    resultado: "impacto medio",
    leads: 1,
    ingresos: 0,
  });
  assert.strictEqual(result.success, true);
  assert.ok(result.decision_trace.decision_id);
  assert.strictEqual(result.workflow_trace.status, "completed");

  const missingProposal = await request("POST", "/api/activar", {
    contexto: "sin propuesta",
  });
  assert.strictEqual(missingProposal.success, false);
  assert.strictEqual(missingProposal.workflow_state, "failed");
  assert.strictEqual(missingProposal.workflow_trace.retry.retry_visible, true);

  const evaluated = await request("POST", "/api/governance/evaluate", {
    propuesta: "hacer deploy a produccion",
    actor: "CEO",
  });
  assert.strictEqual(evaluated.success, true);
  assert.strictEqual(evaluated.governance.status, "approval_required");
  assert.ok(evaluated.decision_trace.decision_id);
  assert.strictEqual(evaluated.workflow_trace.status, "completed");

  const auditSnapshot = await request("GET", "/governance/audit-snapshot");
  assert.strictEqual(auditSnapshot.success, true);
  assert.strictEqual(auditSnapshot.certification.enterprise_ready, false);

  const workflowTraces = await request("GET", "/workflow/traces");
  assert.strictEqual(workflowTraces.status, "READY");
  assert.ok(workflowTraces.trace_count >= 1);

  const survivability = await request("GET", "/automation/survivability");
  assert.ok(survivability.status);
  assert.strictEqual(survivability.retry_intelligence.auto_retry, false);
  assert.strictEqual(survivability.safe_fallback_workflows.governance_hold, true);

  const degraded = await request("GET", "/automation/degraded-operations");
  assert.ok(degraded.status);
  assert.strictEqual(degraded.human_visibility.no_fake_success, true);
  assert.strictEqual(degraded.fallback_execution.retry_policy.auto_retry, false);

  const fallbacks = await request("GET", "/automation/fallbacks");
  assert.strictEqual(fallbacks.status, "READY");
  assert.ok(fallbacks.fallback_execution.execution_mode);

  const providerProbe = await request("POST", "/automation/degradation/probe", {
    ai_status: "DEGRADED_PROVIDER_MISSING",
    failed_or_degraded_count: 1,
  });
  assert.strictEqual(providerProbe.probe_only, true);
  assert.strictEqual(providerProbe.no_workflow_execution, true);
  assert.strictEqual(providerProbe.no_completion_claim, true);
  assert.strictEqual(providerProbe.degraded_operations.states.degraded_ai_coordination, true);
  assert.strictEqual(providerProbe.degraded_operations.operational_continuity.ai_coordination, "degraded_no_fake_completion");

  const memoryProbe = await request("POST", "/automation/degradation/probe", {
    memory_status: "DEGRADED",
    workflow_status: "DEGRADED",
    failed_or_degraded_count: 2,
  });
  assert.strictEqual(memoryProbe.degraded_operations.states.degraded_memory_continuity, true);
  assert.strictEqual(memoryProbe.degraded_operations.fallback_execution.execution_mode, "read_only_memory_recovery");
  assert.strictEqual(memoryProbe.degraded_operations.fallback_execution.recovery_continuity.no_fake_recovery, true);

  const memoryIntegrityProbe = await request("POST", "/memory/degradation/probe", {
    memory_status: "DEGRADED",
    stale_minutes: 99999,
    incomplete: true,
    ai_status: "DEGRADED_PROVIDER_MISSING",
  });
  assert.strictEqual(memoryIntegrityProbe.probe_only, true);
  assert.strictEqual(memoryIntegrityProbe.no_memory_mutation, true);
  assert.strictEqual(memoryIntegrityProbe.operational_memory.status, "DEGRADED_MEMORY");
  assert.strictEqual(memoryIntegrityProbe.operational_memory.memory_survivability.stale_context_detection.state, "STALE");
  assert.strictEqual(memoryIntegrityProbe.operational_memory.memory_survivability.fallback_mode, "read_only_memory_recovery");
  assert.strictEqual(memoryIntegrityProbe.ai_coordination.ai_execution_coherence.no_fake_agi_behavior, true);

  const deployProbe = await request("POST", "/governance/deploy/probe", {
    source_live_verified: false,
    rollback_ready: false,
    ai_status: "DEGRADED_PROVIDER_MISSING",
    failed_or_degraded_count: 1,
  });
  assert.strictEqual(deployProbe.probe_only, true);
  assert.strictEqual(deployProbe.no_deploy_execution, true);
  assert.strictEqual(deployProbe.no_fake_deploy_success, true);
  assert.ok(deployProbe.deploy_integrity.unsafe_deploy_awareness.unsafe_deploy_detected);
  assert.strictEqual(deployProbe.governance.operational_freeze_baseline.freeze_required, true);
  assert.strictEqual(deployProbe.governance.human_visibility.no_fake_automation_stability, true);

  console.log("governance tests ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
