const assert = require("assert");
process.env.CEREBRO_AUTH_TOKEN = process.env.CEREBRO_AUTH_TOKEN || "test-auth-token";

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
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  } finally {
    server.close();
  }
}

(async () => {
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

  const readiness = await request("GET", "/runtime/enterprise-readiness");
  assert.strictEqual(readiness.app, "cerebro");
  assert.strictEqual(readiness.certification.enterprise_ready, false);
  assert.strictEqual(readiness.runtime_truth.secrets_exposed, false);

  const capability = await request("GET", "/api/enterprise/capabilities");
  assert.strictEqual(capability.success, true);
  assert.strictEqual(capability.certification.enterprise_ready, false);

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
  assert.strictEqual(auth.status, "AUTH_REQUIRED");
  assert.strictEqual(auth.secret_exposed, false);
  assert.strictEqual(auth.claim, "protected_endpoints_require_bearer_token");
  assert.strictEqual(getAuthContinuitySnapshot().status, "AUTH_REQUIRED");

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
