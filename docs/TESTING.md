# Pruebas

Tres niveles, con nombres distintos para no confundirlos. **Un test de nivel
«mock» no demuestra nada sobre Gmail real**, y este documento no lo afirma.

| Nivel | Qué es real | Qué es simulado |
|---|---|---|
| **Mock test** | El código de la aplicación (rutas, OAuth+PKCE, bóveda, clientes de Gmail/Calendar/IA/Telegram/n8n) | La red: un `httpx.MockTransport` que responde como Google, Telegram, la IA y n8n |
| **Integration test** | Lo anterior **+ PostgreSQL real**, migraciones reales | Los servicios externos |
| **Real service test** | El servicio externo de verdad | Nada (solo lectura salvo que se pida) |

## Ejecutarlas

```bash
# Backend (SQLite en memoria)           → mock tests
cd backend && python -m pytest

# Frontend                              → componentes y páginas con fetch simulado
cd frontend && npm test && npm run lint && npm run typecheck && npm run build

# Instalador (no necesita Docker)
powershell -File installer/tests/Test-Installer.ps1

# Imágenes Docker (el backend ejecuta sus tests al construirse)
docker build -f backend/Dockerfile -t pa-backend .

# Contra un n8n real (opt-in): lee workflows y ejecuciones por su API
cd backend && AC_N8N_BASE_URL=http://localhost:5678 AC_N8N_API_KEY=<clave> pytest -m integration
```

### En cada push y cada pull request (CI)

`.github/workflows/ci.yml` corre todo lo anterior en GitHub, y es también el
*gate* de `release.yml` (una Release no se construye si falla):

| Job | Qué hace |
|---|---|
| `repo` | Versión coherente (VERSION = backend = frontend), sintaxis de todos los `.ps1`, `docker compose config`, JSON de los workflows |
| `backend` | `pytest`, `pip check` y la imagen Docker con sus tests dentro |
| `migrations` | PostgreSQL 16 real: `alembic upgrade head`, `alembic check` (modelos = migraciones), `downgrade base` y vuelta a subir |
| `n8n` | El n8n de `docker-compose.yml` de verdad: importa los cinco workflows y corre `pytest -m integration` contra su API |
| `frontend` | lint, tipos, tests y build |

## Qué cubre cada suite

| Suite | Qué prueba |
|---|---|
| `backend/tests/test_v3.py` (43) | Prioridad con motivos, memoria (y que rechaza secretos), tareas, modo demo, briefing 2.0, `ask`, insights, sugerencias, confirmación en Telegram (caducidad, un solo uso, solo el chat vinculado), briefing programado, relé `notify`, dependencias, privacidad/seguridad, centro n8n, consejo de reintento |
| `backend/tests/test_e2e_flows.py` (3) | Los 10 flujos: login → dashboard · conectar Google (OAuth real con PKCE) · leer · analizar · redactar · **confirmar envío** · comando de Telegram · crear · ejecutar · fallo → reintento. Y que **ningún secreto** aparece en respuestas ni logs |
| `backend/tests/test_assistant.py`, `test_integrations.py`, `test_automations.py`, `test_observability.py`… | Gmail, Hub, OAuth, builder, errores (v0.6–v2.0, intactos) |
| `backend/tests/test_workflows.py` | Los workflows de n8n no llevan secretos ni chat ids, validan su configuración, reportan fallos; cada envío a Telegram pasa por `¿Bot del launcher?` y tiene su gemelo por el panel (`/api/automations/notify`) |
| `backend/tests/test_ai_stream.py` (16) | Streaming de los tres dialectos (deltas, uso, comentarios SSE, error a mitad), *fallback* solo antes del primer token, Stop cierra la conexión con el proveedor, endpoint SSE (códigos HTTP antes del stream, `event: error` después, contadores y auditoría) |
| `frontend/src/pages/v3.test.tsx` (26) | Tareas, centro n8n, atajos (`G` + tecla), paleta, memoria, modo demo, privacidad/seguridad, credenciales 2.0, Inbox (filtros, razones, **confirmación antes de enviar**), vista de presentación |
| `frontend/src/pages/assistant.test.tsx` | Chat estructurado: secciones, botones, contexto personal enviado al modelo; sigue respondiendo si el contexto falla. Streaming: el texto crece en pantalla, **Stop** conserva lo recibido, un fallo a mitad lo explica, una directiva de acción a medio escribir nunca se ve, y un backend sin streaming responde de una vez |
| `frontend/src/api/sse.test.ts` | Lector SSE (eventos partidos entre paquetes, comentarios, CRLF) y `aiApi.generateStream` |
| `frontend/src/features/activity/ExecutionView.test.tsx` | Línea de tiempo y reintento inteligente |
| `installer/tests/Test-Installer.ps1` (108) | Rutas de datos, migración, sin escribir en Program Files |

## n8n real

Resultado del **2026-10-12**, en un entorno desechable: **n8n 1.121.3** (la
imagen de `docker-compose.yml`) y **PostgreSQL 16** en contenedores, el backend
de esta rama, y en los bordes externos (Telegram Bot API, scraper e IA) servidores
locales que hablan el mismo protocolo — nada de Gmail, Telegram ni IA reales.

| Comprobación | Resultado |
|---|---|
| Importar los 5 workflows (`n8n import:workflow`) | ✅ |
| `pytest -m integration` contra la API de n8n (salud, los 4 asistentes visibles, ejecuciones) | ✅ 3/3 |
| **Laboral completo**: perfil (`/api/profiles/runtime`) → scraper → filtro → *scoring* → IA por `/api/ai/generate` (esquema JSON validado) → digest → `¿Bot del launcher?` = no → `/api/automations/notify` → bot del panel | ✅ mensaje entregado en HTML al chat vinculado |
| Laboral sin ofertas que encajen | ✅ ahora avisa «ninguna de las N ofertas encajó con tu perfil» (antes se paraba sin decir nada; corregido) |
| Laboral con bot propio a medias (token sin chat id) | ✅ se para en *Comprobar configuracion* con el motivo |
| Laboral con bot propio completo | ✅ elige la ruta directa a `api.telegram.org` |
| **Gestor de errores** con un fallo de producción (webhook) | ✅ `/api/automations/events` (actividad del panel) + aviso por el bot del panel; el segundo fallo igual en la misma hora, silenciado |
| Migraciones en PostgreSQL real: `upgrade head`, `alembic check`, `downgrade base`, `upgrade head` | ✅ sin deriva |
| Chat en streaming en Chromium real contra el backend | ✅ primer token a ~0,2 s (antes había que esperar a la respuesta entera), cursor al final del texto, sin errores de consola |

## Qué se ha probado con servicios reales

Resultado del **2026-10-06**, sobre la instalación de este equipo. Solo lectura;
no se envió ningún mensaje ni se tocó ningún dato.

| Comprobación | Resultado |
|---|---|
| **n8n** (contenedor `pa-n8n`) `/healthz` | ✅ `{"status":"ok"}` — servicio real |
| **Telegram Bot API** `getMe` con los 4 bots de los asistentes de serie | ✅ los 4 válidos (`@email_TDR_bot`, `@noticias_TDR_bot`, `@laboral_TDR_bot`, `@marca_TFR_bot`) — servicio real |
| **Backend instalado** (`pa-backend`) `/api/health` | ✅ ok, base de datos ok — **versión 0.4.0**: la instalación de este equipo **no se ha actualizado** a la v3 |
| **PostgreSQL 16 real**: migraciones `0001 → 0005`, bajar `0005` y volver a subir; memoria, tareas y contadores | ✅ en un contenedor desechable (ya eliminado); sin tocar tu base de datos |
| Imágenes Docker de backend (con sus tests dentro) y frontend | ✅ se construyen desde el código fuente |
| **Gmail real** | ⛔ **no probado**: no hay ninguna cuenta de Google conectada en esta instalación |
| **Gemini real** | ⛔ **no probado**: no hay clave de Gemini (hay OpenRouter y NVIDIA NIM configurados, no se usaron) |
| Telegram: **enviar** un mensaje / responder a un comando | ⛔ no probado con el servicio real (solo `getMe`) |
| Flujo completo Gmail → IA → n8n → Telegram | ⛔ **no probado en real**; solo con servicios simulados (`test_e2e_flows.py`) |

### Cómo completar la validación real

1. Actualiza la instalación a la v3 (instalador) y abre el panel.
2. **Integraciones**: conecta Google (el panel guía el alta de la app OAuth),
   Telegram (token + *Start*) y comprueba la IA en **Ajustes → AI**.
3. Ejecuta:

   ```bash
   python scripts/real-check.py --api http://localhost:8082 --user tu@correo
   ```

   Pide la contraseña sin mostrarla. Cada paso termina en `PASS` (funcionó con el
   servicio real), `FAIL` (con el motivo) o `SKIP` (no conectado: **no se prueba y
   no se afirma nada**). Solo imprime recuentos y prioridades: nunca asuntos,
   cuerpos, tokens ni claves. `--send-telegram` envía además un mensaje de prueba
   real a tu chat.

## Qué se verificó visualmente

Contra un backend de pruebas, en el navegador: Home (Command Center), Assistant
(tarjetas interactivas), Inbox (análisis, motivos, confirmación), Integraciones,
detalle de Google (salud, permisos, diálogo de dependencias), Errores, Ejecución,
Ajustes (memoria, privacidad, seguridad, demo), centro n8n y vista de
presentación. **Sin desbordes** en 375, 390, 430, 768, 1024 y 1440 px (20 rutas ×
6 anchos), sin errores de consola, y sin elementos sin nombre accesible. Esto
encontró dos fallos reales que los tests no veían (diálogo de desconexión que
rompía la página al montarse cerrado; botón del briefing desbordando en móvil),
ya corregidos y con test de regresión.
