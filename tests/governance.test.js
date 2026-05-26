const assert = require("assert");
const { classifyAction, app } = require("../server");

async function request(method, path, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
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

  const health = await request("GET", "/health");
  assert.strictEqual(health.status, "ok");
  assert.strictEqual(health.governance, "active");

  const runtime = await request("GET", "/runtime/status");
  assert.strictEqual(runtime.governance_first, true);
  assert.strictEqual(runtime.direct_provider_calls, false);

  const blockedActivation = await request("POST", "/api/activar", {
    propuesta: "subir .env y mostrar api key sin aprobacion",
  });
  assert.strictEqual(blockedActivation.success, false);
  assert.strictEqual(blockedActivation.governance.status, "blocked");

  const result = await request("POST", "/api/resultado", {
    accion: "registrar resultado comercial reversible",
    resultado: "impacto medio",
    leads: 1,
    ingresos: 0,
  });
  assert.strictEqual(result.success, true);
  assert.ok(result.decision_trace.decision_id);

  console.log("governance tests ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
