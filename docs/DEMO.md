# Demo y modo presentación (TDR)

Dos herramientas para enseñar el producto sin exponer correo ni credenciales
personales. Ninguna de las dos se confunde con el uso real: ambas están
etiquetadas como datos de ejemplo.

## Modo demo

**Ajustes → Demo mode** (o `Ctrl K` → «demo»). Mientras está activo:

- Inbox, análisis con IA, borradores, briefing, insights, sugerencias, el chat y
  el bot de Telegram usan **un día de ejemplo** en lugar de tu cuenta de Google.
- Un banner **«Demo mode»** aparece en todas las pantallas, con un botón para apagarlo.
- **No se envía nada** (ni correo ni Telegram), **no cambia nada en Google**, no
  se llama a ninguna IA y no se usan credenciales reales. El briefing automático
  tampoco se envía.

### El escenario

| Qué | Contenido |
|---|---|
| 5 correos | tutora (entrega del TDR, **urgente**, remitente importante), club (cambio de horario), Laura (repasar mates), boletín de IA (baja prioridad), admisiones (con PDF) |
| 3 eventos | Matemáticas 09:00 · Reunión con la tutora 13:00 · Entrenamiento 18:00 |
| 1 fecha límite | Entregar la presentación del TDR (el próximo viernes, 17:00) |
| 4 automatizaciones | Email Assistant, Daily Briefing, Important Email Alert, Failed Automation Alert |
| 2 ejecuciones | una correcta, una **fallida** (Gemini agotó el tiempo) |
| 1 error | «AI provider failed», con causa y acción: reintentar |

### Guion de 5 minutos

1. **Home** (Command Center): saludo, barra de IA, *Today* (correos importantes,
   eventos, fechas límite), *AI insights*. «¿Qué tengo pendiente hoy?» → tarjetas
   interactivas, no solo texto.
2. **Inbox**: el correo de la tutora aparece **URGENTE**. Ábrelo → *Analyze with AI*:
   prioridad + **por qué** (remitente importante, fecha límite en 48 h, requiere
   respuesta), tarea detectada, *Add to Calendar*.
3. **Responder**: *Reply professionally* → editar → *Review and send*: aparece el
   diálogo de confirmación. En demo dice «nothing was sent».
4. **Automatizaciones**: *Create automation* → escribir en lenguaje natural; o una
   plantilla. Salud por automatización.
5. **Errores**: la ejecución fallida → causa (timeout de Gemini), impacto,
   **reintentar** (o *Reconnect* si fuera una conexión caducada).
6. **Seguridad y privacidad**: Ajustes → Privacy (qué ve la IA) y Security.

## Vista de presentación

`/presentation` (Ajustes → Demo mode → *Open the presentation view*). Una página
limpia de cinco secciones con datos de ejemplo siempre: el inbox entendido por la
IA, tu día, automatizaciones sanas, qué pasa cuando algo falla, y control humano
+ local-first. Es independiente del interruptor del modo demo y nunca toca una
cuenta real.

## Teclado durante la demo

`Ctrl K` busca y ejecuta · `Ctrl /` lista los atajos · `G H` Home · `G I` Inbox ·
`G A` Automatizaciones · `G T` Integraciones.
