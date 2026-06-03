# CEREBRO OpenRouter Token Budget Report

Fecha: 2026-06-03

## Resultado

`CEREBRO_OPENROUTER_MAX_TOKENS` quedo configurado y validado en Production con valor `18000`.

El backend quedo protegido para no volver a usar defaults bajos:

- default anterior en produccion detectado: variable existente con valor vacio;
- default anterior en codigo historico detectado: `20` en checkout previo y `1200` en `origin/main`;
- nuevo default seguro en codigo: `18000`;
- nuevo valor en Vercel Production: `18000`;
- max_tokens enviado a OpenRouter en validacion local interceptada: `18000`.

## Cambios Aplicados

Archivo:

`server.js`

Cambios:

- se agrego `OPENROUTER_DEFAULT_MAX_TOKENS = 18000`;
- `boundedProviderMaxTokens()` ahora usa `18000` cuando no existe variable;
- una variable mal configurada con valor menor no baja el cap por debajo de `18000`;
- `/api/chat` ahora solicita `maxTokens: 18000`;
- `executeProvider()` valida credenciales dinamicamente;
- `/runtime/status` expone metadata no sensible de token budget.

Archivo:

`tests/governance.test.js`

Cambios:

- prueba de default sin env var: `18000`;
- prueba de env var baja: se protege en `18000`;
- prueba interceptada de Axios: payload a OpenRouter contiene `max_tokens: 18000`;
- prueba de `/runtime/status`: default/effective `18000`.

## Vercel Production

Proyecto:

`cerebro-app`

URL:

`https://cerebro-app-eta.vercel.app`

Variable:

`CEREBRO_OPENROUTER_MAX_TOKENS=18000`

Estado:

PASS

Nota:

La variable existia antes, pero estaba vacia. Se reemplazo sin tocar:

- `OPENROUTER_API_KEY`;
- `OPENROUTER_MODEL`;
- KV / Upstash;
- UI.

## Deploy

Deployment:

`dpl_892nHw2p344WPpydULuYxND27LFU`

URL temporal:

`https://cerebro-ip6jzzm6r-danielglezsolucionador-boops-projects.vercel.app`

Alias Production:

`https://cerebro-app-eta.vercel.app`

## Runtime Production

`GET /runtime/status`

Resultado:

```json
{
  "provider_ready": true,
  "official_provider": "openrouter",
  "openrouter_token_budget": {
    "default_max_tokens": 18000,
    "env_configured": true,
    "effective_max_tokens": 18000
  },
  "storage": {
    "enabled": true,
    "uses_tmp_only": false
  }
}
```

## Validacion de Conversacion Real

Prompt 1:

`CEREBRO, quiero subir el ecosistema a la nube. Dame los pasos exactos sin tocar nada todavía.`

Resultado:

- `success=true`;
- `provider=openrouter`;
- `provider_status=READY`;
- `conversation_persisted=true`;
- longitud respuesta: 1933 caracteres;
- palabras: 281;
- pasos concretos: SI;
- respuesta cortada: NO.

Prompt 2:

`Hazme un plan operativo de 7 pasos para ordenar CEREBRO, DCFT y FORJA sin abrir frentes innecesarios.`

Resultado:

- `success=true`;
- `provider=openrouter`;
- `provider_status=READY`;
- `conversation_persisted=true`;
- longitud respuesta: 2117 caracteres;
- palabras: 319;
- menciona CEREBRO/DCFT/FORJA: SI;
- plan de 7 pasos: SI;
- respuesta cortada: NO.

## Costo Aproximado

Modelo actual:

`openai/gpt-4o-mini`

Tarifa publica OpenRouter consultada el 2026-06-03:

- input: USD 0.15 por 1M tokens;
- output: USD 0.60 por 1M tokens.

Fuente:

`https://openrouter.ai/models/openai/gpt-4o-mini`

Estimacion practica:

- conversacion corta/media con 3k input tokens y 500 output tokens: aprox. USD 0.00075;
- respuesta larga usando 5k input tokens y 2k output tokens: aprox. USD 0.00195;
- peor caso teorico si el modelo emitiera 18k output tokens: aprox. USD 0.0108 solo en output, mas input.

Conclusiones de costo:

- `max_tokens=18000` no significa que cada respuesta cueste 18k tokens;
- solo abre techo de salida para evitar cortes;
- costo real depende de tokens efectivamente generados.

## Estado Final

OpenRouter Production:

PASS

Chat real:

PASS

Token budget:

PASS

Respuestas no cortadas:

PASS

Persistencia:

PASS

UI modificada:

NO

Modelo cambiado:

NO

Proveedor cambiado:

NO

API key modificada:

NO

KV modificado:

NO

