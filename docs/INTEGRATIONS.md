# Integraciones

Gmail, Gemini (u otro proveedor de IA), Telegram y n8n trabajan juntos. Este
documento explica **qué hace cada una, cómo se conecta, qué permisos usa y cómo
falla**. Todo se conecta desde el panel (**Integraciones**): no hay que editar
ficheros ni copiar tokens.

```
 Gmail ──►  Personal Assistant ──►  IA (Gemini…)  ──►  n8n  ──►  Telegram
 (OAuth)     (backend + panel)       (entiende)       (ejecuta)   (te avisa)
```

## Google (Gmail, Calendar, Drive)

| | |
|---|---|
| Autenticación | OAuth 2.0 con PKCE; `state` sellado y de un solo uso; el token se renueva solo |
| Alta única | Registrar una app OAuth en Google Cloud (el panel te guía en **Integraciones → Google → Avanzado**) |
| Servicios | **Gmail** (leer + enviar), **Calendar** (ver y crear eventos), **Drive** (solo archivos que crea el asistente) |
| Opcional | **Organizar Gmail** (`gmail.modify`): archivar y marcar importante. Es un permiso aparte: quien no lo concede conserva todo lo demás |
| Desconectar | Revoca el acceso en Google y borra los tokens. Antes se muestra qué dejará de funcionar |

Lo que el asistente hace con Gmail: buscar con la sintaxis de Gmail, filtrar por
sin leer/importantes/adjuntos, **analizar con IA** (prioridad, categoría,
acción requerida, resumen, fecha límite, tareas), redactar respuestas (formal,
informal, concisa, detallada), **enviarlas en el mismo hilo solo tras tu
confirmación**, crear una tarea o un recordatorio en Calendar, y abrir el
Automation Builder con "Automatizar correos de este remitente".

## IA (Gemini, NVIDIA NIM, OpenRouter)

El proveedor, el modelo y la clave se eligen en **Ajustes → AI**; la clave se
guarda cifrada. Hay *fallback* automático a otro proveedor configurado. El panel
muestra modelo, peticiones de hoy, latencia media y errores de hoy.

**El chat responde en streaming** (`POST /api/ai/generate/stream`, eventos
`start` · `delta` · `done` · `error`): la respuesta aparece con la primera
palabra en vez de esperar a la última. Los tres dialectos lo soportan (NIM y
OpenRouter con `stream: true`, Gemini con `streamGenerateContent?alt=sse`).
El *fallback* sigue funcionando, pero solo **antes del primer token**: una vez
que el texto ha llegado a la pantalla, cambiar de proveedor lo repetiría o lo
contradiría, así que un fallo a mitad se muestra tal cual («la respuesta se
interrumpió: …») y se conserva lo recibido. **Stop** corta la petición de verdad
y también conserva lo recibido. Las automatizaciones siguen usando
`/api/ai/generate`, que valida el JSON entero.

Qué recibe la IA y qué no: ver **Ajustes → Privacy** (se genera con tu
configuración real) y [SECURITY.md](SECURITY.md).

## Telegram

1. Pegas el token que te da @BotFather → el panel lo valida (`getMe`).
2. Pulsas **Start** en Telegram → el panel detecta tu chat. No hay chat id que copiar.

El bot es una extensión real del asistente. Solo responde a tu chat vinculado.

| Comando | Qué hace |
|---|---|
| `/emails` | Correos sin leer (🔴 urgente, 🟠 alta) |
| `/reply N` | Prepara una respuesta al correo N y la **enseña antes de enviar** |
| `/edit texto` | Cambia la respuesta pendiente |
| `/briefing` | El resumen del día |
| `/tasks` | Tareas y fechas límite |
| `/automations` | Tus automatizaciones |
| `/errors` · `/status` | Qué falla · estado general |

También entiende lenguaje natural: «¿qué tengo hoy?», «¿tengo algún correo
urgente?», «¿qué automatizaciones han fallado?», «hazme el briefing».

Para no bombardearte, las alertas se **agrupan en el briefing diario**
(`Ajustes → AI memory`: hora y canal). Las respuestas con botones usan una
confirmación que caduca a los 15 minutos.

Cada mensaje se atiende **como mucho una vez**: el bot confirma el mensaje a
Telegram *antes* de procesarlo. Si uno falla de forma inesperada recibes un
«No he podido procesar eso ahora mismo» y el bot sigue con el siguiente; antes,
un mensaje así bloqueaba la cola y se repetía cada pocos segundos.

¿Servidor propio de la Bot API? `AC_TELEGRAM_API_URL=http://tu-servidor:8081`
(vacío = `api.telegram.org`).

## n8n

n8n es el **motor**, no la interfaz: las automatizaciones se construyen en el
panel y se compilan a workflows que solo hacen llamadas HTTP a la API del
backend (el texto del usuario nunca viaja dentro de n8n). La página
**Automatizaciones → Engine status** muestra workflows, activos, ejecuciones de
hoy, tasa de éxito y la última ejecución sin abrir n8n.

Si n8n está apagado, el panel dice *«n8n unavailable. Tus automatizaciones
guardadas están a salvo»*: se pueden seguir editando y se ejecutan al volver.

## Plantillas de automatización

| Plantilla | Flujo |
|---|---|
| Email Assistant | Gmail → IA → Telegram |
| Daily Briefing | Gmail → IA → Telegram |
| Important Email Alert | Gmail → IA → Telegram |
| Deadline Detector | Gmail → IA → Calendar |
| Email Summarizer | Gmail → IA → Drive |
| Failed Automation Alert | n8n → Telegram (workflow del sistema `00-error-handler`) |

## Los 4 asistentes de serie y Telegram

Los workflows `01-email`, `02-laboral`, `03-news`, `04-marca-personal` y el
gestor de errores `00-error-handler` envían por **el Telegram que conectas en el
panel**: antes de cada envío, un nodo `¿Bot del launcher?` decide la ruta.

```
            ┌─ sí: token propio + TELEGRAM_CHAT_ID ─► api.telegram.org (bot propio)
 mensaje ─► ¿Bot del launcher?
            └─ no ────────────────────────────────► POST /api/automations/notify
                                                     (token de servicio) ─► bot del panel
```

- Sin tocar nada en el launcher, todo llega por **un solo bot**, cifrado en
  PostgreSQL. n8n nunca ve su token.
- Quien ya tenía los cuatro bots del launcher **no nota ningún cambio**: con
  token y chat id, cada asistente sigue usando el suyo.
- Un bot a medias (token sin chat id, o un token mal copiado) para el workflow en
  *Comprobar configuracion* con un mensaje que dice qué falta; nunca se
  redirige en silencio.
- El destinatario es el dueño del perfil activo (`AC_PROFILE_ID`) o, si ese
  usuario no tiene Telegram, el primer administrador que lo tenga.

Validado contra n8n 1.121.3 real (ver [TESTING.md](TESTING.md#n8n-real)). El
historial de la decisión está en
[V3-AUDIT.md](V3-AUDIT.md#los-4-asistentes-de-serie-y-telegram).

## Estados de una conexión

`healthy` · `degraded` (responde a medias) · `expired` / `auth_required` (hay que
volver a iniciar sesión) · `error` · `pending` (falta vincular el chat) ·
`not_connected`. El Error Center muestra causa, impacto y la acción que lo arregla.
