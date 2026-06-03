# CEREBRO Critical Product Recovery Report

Fecha: 2026-06-03
Produccion validada: https://cerebro-app-eta.vercel.app
Estado final: implementacion tecnica recuperada; aprobacion CEO pendiente.

## 1. Estado inicial encontrado

- Rama local: `main`
- HEAD local inicial de esta tanda: `275456c`
- HEAD remoto inicial: `275456c`
- Git status inicial: limpio
- Produccion: `https://cerebro-app-eta.vercel.app`
- Vercel deployment inicial revisado: `Ready`
- Runtime productivo inicial: 200
- Storage productivo inicial: 200
- OpenRouter inicial: `provider_ready=true`
- Storage inicial: `storage_enabled=true`, `uses_tmp_only=false`
- Endpoint conversaciones: disponible
- Boton de voz: presente en HTML productivo
- Intro copy correcta: presente
- Saludo generico nuevo: no detectado en HTML productivo

Hallazgo nuevo de esta tanda:

- `CEREBRO_OPENROUTER_MAX_TOKENS` estaba en `18000`.
- El nuevo criterio operativo define:
  - minimo util: `1200`
  - recomendado: `1800`
  - maximo inicial sin aprobacion: `2500`
- Por lo tanto, `18000` era excesivo para la fase actual y fue corregido.

## 2. Fixes ya aplicados antes de esta tanda

- Persistencia KV revisada y activa.
- Recuperacion de ultima conversacion persistida trabajada.
- Endpoint de conversaciones trabajado.
- Boton de voz agregado.
- Bug de token floor detectado.
- Default inutil de tokens eliminado.
- Respuestas largas empezaron a responder mejor en produccion.
- Push y deploy de recuperacion realizados.

## 3. Cambios nuevos aplicados en esta tanda

### Token budget

- `OPENROUTER_DEFAULT_MAX_TOKENS`: `18000` -> `1800`
- Vercel Production:
  - `CEREBRO_OPENROUTER_MAX_TOKENS=1800`
- Tests agregados/reforzados para asegurar que valores `1`, `8` y `20` no reduzcan el presupuesto util.
- El sistema permite `2500` si luego se aprueba/configura.

### Calidad Chief of Staff

- Se reforzo el prompt de sistema para respuestas operativas.
- Estructura obligatoria:
  1. Entendimiento claro.
  2. Objetivo.
  3. Orden de ejecucion.
  4. Riesgos.
  5. Que NO voy a tocar.
  6. Primer paso exacto.
  7. Confirmacion requerida si hay riesgo.
- La seccion `Que NO voy a tocar` pasa a ser obligatoria en planes, recuperaciones, auditorias, despliegues o coordinacion entre apps.

## 4. Commits realizados

- `443e3fe` - `fix cerebro openrouter token policy`
- `a0d7764` - `fix cerebro chief of staff response structure`

Commits previos relevantes:

- `275456c` - `docs: report cerebro production priority recovery`
- `d66ca23` - `fix cerebro conversation persistence continuity`
- `bd3f278` - `docs: report cerebro openrouter token budget fix`
- `8c8ad86` - `fix cerebro openrouter token budget`
- `1f73bfb` - `fix cerebro restore latest persisted conversation`
- `fbd6450` - `fix cerebro openrouter response token floor`

Backups:

- `backup/cerebro-priority-recovery-20260603-092124`
- `backup/cerebro-token-policy-1800-20260603-093647`

## 5. Estado de token bug

Estado: PASS

Evidencia produccion:

- Runtime: `openrouter_token_budget.default_max_tokens=1800`
- Runtime: `openrouter_token_budget.effective_max_tokens=1800`
- Env configurada: `CEREBRO_OPENROUTER_MAX_TOKENS=1800`
- OpenRouter: `provider_status=READY`

Prueba de respuesta operativa:

- Prompt: `CEREBRO, quiero subir el ecosistema a la nube. Dame los pasos exactos sin tocar nada todavia.`
- Respuesta: `success=true`
- Provider: `openrouter`
- Provider status: `READY`
- Longitud: `1440` caracteres
- Persistida: `true`
- Cortada: `false`
- Incluye `Que NO voy a tocar`: `true`
- Incluye `Primer paso exacto`: `true`

## 6. Persistencia UI

Estado: PASS con evidencia automatizada de carga/reload.

Evidencia:

- La UI abre la ultima conversacion persistida real desde KV.
- Tras reload, la conversacion sigue visible.
- No vuelve a saludo generico viejo.
- No se detecto overflow horizontal.
- Console errors: `0`

Validacion navegador integrado:

- Viewport observado: `377x608`
- `containsLatestPrompt=true`
- `containsNoTouch=true`
- `containsGenericGreeting=false`
- `hasVoiceButton=true`
- `horizontalOverflow=false`

Nota:

La herramienta automatizada tuvo limitaciones para hacer click/tipado directo en el layout movil exacto. Aun asi, se valido que la UI carga y recarga la conversacion persistida real. La prueba humana final desde celular debe confirmar envio manual con teclado nativo.

## 7. Persistencia API

Estado: PASS

Evidencia conversacion larga:

- Session: `ceo_recovery_conversation_20260603094040`
- `conversation_persisted=true`
- Mensajes almacenados: `8`
- Prompts probados:
  - Plan para subir ecosistema a la nube.
  - Explicacion mas simple.
  - Que estamos haciendo ahora.
  - Resumen y siguiente paso.
- Todas las respuestas:
  - `success=true`
  - `provider=openrouter`
  - `provider_status=READY`
  - no cortadas
  - persistidas

Evidencia adicional:

- Session: `chief_quality_retest_20260603094317`
- Mensajes almacenados: `2`
- Persistida: `true`
- Respuesta con estructura Chief of Staff correcta.

## 8. Voz

Estado: PASS funcional con fallback; dictado real requiere prueba humana con microfono fisico.

Evidencia produccion:

- Boton de voz presente: `voiceButton`
- Visible: `true`
- Disabled: `false`
- Aria label: `Dictar mensaje por voz`
- Estados/copy presentes:
  - `Escuchando`
  - `Procesando voz`
  - fallback de voz no disponible
- En navegador de validacion:
  - `speechRecognitionSupported=false`
  - fallback disponible
  - console errors: `0`

Pendiente humano:

- Probar desde celular real concediendo permiso de microfono.
- Dictar un mensaje corto y confirmar transcripcion/envio.

## 9. Mobile

Estado: PASS en viewport movil automatizado disponible; 390x844 exacto queda pendiente si no se dispone de navegador externo.

Evidencia:

- Viewport automatizado observado: `377x608`
- Input visible: `true`
- Boton enviar visible: `true`
- Boton voz visible: `true`
- Historial visible: `true`
- Overflow horizontal: `false`
- Imagenes rotas: `0`
- Console errors: `0`

Pendiente humano recomendado:

- Validar desde celular real a `https://cerebro-app-eta.vercel.app`.
- Confirmar que no hay scroll horizontal y que el input queda usable con teclado abierto.

## 10. Memoria operativa

Estado: PASS

Prueba:

- Mensaje 1: `Estamos trabajando en recuperar CEREBRO, luego FORJA, luego DCFT.`
- Mensaje 2: `Cual es el orden?`

Resultado:

- Session: `memory_order_20260603095023`
- Persistida: `true`
- Mensajes: `4`
- Respuesta menciona:
  - CEREBRO: `true`
  - FORJA: `true`
  - DCFT: `true`
- Orden correcto CEREBRO -> FORJA -> DCFT: `true`
- Sin JSON crudo.

## 11. Entregables

Estado: PASS

Prueba:

- Solicitud: generar reporte y guardarlo como `CEREBRO_RECOVERY_TEST_REPORT_20260603095023.md`

Resultado:

- Chat success: `true`
- Entregable devuelto por `/api/chat`: `true`
- `/api/deliverables` contiene archivo: `true`
- Human Cabin snapshot contiene archivo: `true`
- Entregables visibles en Human Cabin: `8`

## 12. Local Agent

Estado: PASS

Evidencia produccion posterior al ultimo deploy:

- Existing agents before: `3`
- Agent registrado: `true`
- Token generado y no impreso: `true`
- Heartbeat: `active`
- Task type: `report_generation`
- Requiere aprobacion humana: `true`
- Requiere backup: `true`
- Approval status: `queued`
- Poll contiene tarea: `true`
- Lease: `leased`
- Snapshot count: `1`
- Backup count: `1`
- Rollback record: `true`
- Artifact visible: `true`
- Final status: `completed`
- Dashboard completed: `2`
- Human Cabin Local Agent tasks: `12`

Seguridad:

- No se imprimio token.
- Payload con marcadores sensibles fue rechazado por `payload_contains_secret` durante pruebas, lo que confirma defensa activa.
- No hay push/deploy automatico desde Local Agent.

## 13. Pruebas ejecutadas

Locales:

- `npm test`: PASS
- `npm run build`: PASS

Produccion:

- `/runtime/status`: 200
- `/storage/status`: 200
- `/api/conversations`: 200
- `/api/chat`: PASS
- `/api/deliverables`: PASS
- `/api/human-cabin/state`: PASS
- `/local-agent/dashboard`: PASS
- `/local-agent/agents`: PASS
- `/agent/v1/heartbeat`: PASS
- `/agent/v1/tasks/poll`: PASS
- Snapshot/backup/rollback/artifact/result: PASS

Seguridad:

- Secret scan local: sin secretos reales.
- Coincidencias detectadas: placeholders vacios/fake de proveedor IA en tests.

## 14. Resultado por bloque

- Estado real actual: PASS
- Vercel env/token budget: PASS tras correccion a `1800`
- Conversacion larga: PASS
- Persistencia UI: PASS para carga/reload; envio manual exacto queda para prueba humana por limitacion de automatizacion
- Saludos genericos nuevos: PASS, no detectados
- Voz: PASS funcional con fallback; dictado real pendiente celular/microfono
- Mobile: PASS en viewport disponible, pendiente prueba humana 390x844 real
- Memoria operativa: PASS
- Calidad Chief of Staff: PASS tras refuerzo
- Entregables: PASS
- Local Agent: PASS
- Costos/modelo/API: PASS documentado

## 15. URL produccion validada

https://cerebro-app-eta.vercel.app

Ultimo deploy manual validado:

- Commit: `a0d7764`
- Deployment: `dpl_6ky1JbBAudwd4QNFMWi8CnHDyjgE`
- Estado: `READY`
- Alias: `https://cerebro-app-eta.vercel.app`

## 16. Pendientes reales

No declarar CEREBRO cerrado todavia.

Pendientes:

1. Aprobacion CEO visual/uso real.
2. Prueba humana de envio manual desde celular.
3. Prueba humana de microfono real con permiso concedido.
4. Validacion exacta 390x844 en dispositivo o navegador externo con viewport controlado.
5. Decidir si mantener `1800` tokens o subir a `2500` si el CEO pide respuestas mas largas.
6. Definir politica de limpieza/archivo de conversaciones historicas sin borrar datos criticos.

## 17. Recomendacion modelo/API/costos

Modelo actual:

- Provider: OpenRouter
- Modelo efectivo por default de codigo: `openai/gpt-4o-mini`
- Env de modelo en Vercel: no configurada explicitamente
- Token budget actual: `1800`

Precio de referencia OpenRouter:

- `openai/gpt-4o-mini`: desde `$0.15/M` input tokens y `$0.60/M` output tokens.
- Fuente: https://openrouter.ai/models/openai/gpt-4o-mini

Estimacion aproximada:

- Conversacion corta/media: 2,000 input tokens + 700 output tokens ~= `$0.00072`
- 100 conversaciones: ~= `$0.07`
- 1000 conversaciones: ~= `$0.72`

Rango conservador para conversaciones largas:

- 4,000 input tokens + 1,200 output tokens ~= `$0.00132`
- 100 conversaciones largas: ~= `$0.13`
- 1000 conversaciones largas: ~= `$1.32`

Opciones:

### Opcion A: mantener modelo actual + 1800 tokens

Recomendado ahora.

- Bajo costo.
- Respuestas ya no se cortan en pruebas.
- Suficiente para operacion diaria.

### Opcion B: mantener modelo actual + 2500 tokens

Usar si el CEO detecta respuestas utiles pero demasiado comprimidas.

- Sigue bajo costo.
- Mayor margen para planes largos.
- Requiere decision explicita antes de cambiar.

### Opcion C: modelo superior temporal para pruebas

No recomendado todavia.

- Solo conviene si CEREBRO falla en calidad estrategica pese a buen prompt y memoria.
- Debe probarse por ventana controlada para no abrir costos ni cambiar identidad operacional.

## Conclusion

CEREBRO tiene recuperacion tecnica validada:

- Conversacion real: SI
- OpenRouter real: SI
- Token budget corregido: SI
- Persistencia API: SI
- Persistencia UI en carga/reload: SI
- Voz con fallback: SI
- Mobile automatizado disponible: SI
- Memoria operativa: SI
- Entregables: SI
- Local Agent: SI

Estado final:

Implementacion tecnica recuperada.
Aprobacion CEO pendiente.
