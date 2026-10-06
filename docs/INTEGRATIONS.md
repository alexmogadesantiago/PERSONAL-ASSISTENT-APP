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

## Los 4 asistentes de serie y Telegram (deuda conocida)

Los workflows `01-email`, `02-laboral`, `03-news` y `04-marca-personal` envían a
Telegram con **sus propios bots**, cuyos tokens salen del launcher (variables
`TELEGRAM_*` en el entorno de n8n), no del Integrations Hub. Es un segundo
sistema de credenciales. El análisis completo y el plan de migración están en
[V3-AUDIT.md](V3-AUDIT.md#los-4-asistentes-de-serie-y-telegram). Mientras tanto
**siguen funcionando igual**: no se ha tocado ningún workflow.

## Estados de una conexión

`healthy` · `degraded` (responde a medias) · `expired` / `auth_required` (hay que
volver a iniciar sesión) · `error` · `pending` (falta vincular el chat) ·
`not_connected`. El Error Center muestra causa, impacto y la acción que lo arregla.
