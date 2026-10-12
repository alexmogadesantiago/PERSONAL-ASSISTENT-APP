# Credenciales y APIs — guía completa

Todas las automatizaciones funcionan **sin tocar código**. Solo hay que dar de
alta estas credenciales. Ordenadas de menos a más esfuerzo.

> **En el panel:** la página **Credentials** muestra esta misma lista con el
> estado real de cada credencial (lo que el backend puede comprobar sale como
> *Ready / Missing / Not working*; lo que vive solo en n8n sale como *Verify in
> n8n*, nunca como "listo"), enlaces directos para configurarla y la guía OAuth
> de Google con la redirect URI lista para copiar y los scopes exactos.

| Servicio | Lo usan | Dónde se pone | Coste |
|---|---|---|---|
| Proveedor de IA (NVIDIA NIM, OpenRouter o Gemini) | Noticias, Marca Personal, Laboral, Email | **panel web** → Settings → Artificial Intelligence | Gratis / de pago según proveedor |
| Telegram (un bot) | Noticias, Marca Personal, Laboral, Email y los avisos de fallo | **panel web** → Integraciones → Telegram | Gratis |
| Bots propios por asistente (opcional) | El asistente que lo tenga | launcher → **Ajustes** (escribe el `.env`) | Gratis |
| Google OAuth (Gmail + Calendar) | **solo** Email | n8n → Credentials | Gratis |

Nada de esto se sube a git: `.env` está en `.gitignore`.

---

## 1. Proveedor de IA

Los workflows **ya no llevan la clave de ningún proveedor**. Llaman al
Automation Center y es el panel quien decide quién responde, así que cambiar de
proveedor no toca ni un workflow.

Elige **uno** (puedes añadir un segundo como respaldo):

| Proveedor | Dónde sacar la clave | Notas |
|---|---|---|
| **NVIDIA NIM** (recomendado) | <https://build.nvidia.com> → abre un modelo → **Get API Key** (`nvapi-…`) | Principal por defecto |
| **OpenRouter** | <https://openrouter.ai/keys> (`sk-or-…`) | Muchos modelos tras un solo endpoint; buen fallback |
| **Gemini** | <https://aistudio.google.com/app/apikey> (`AIza…`) | Opcional. Si ya lo tenías, sigue funcionando sin tocar nada |

### Configurarlo (una sola vez, sin terminal)

1. Abre el panel → **Settings → Artificial Intelligence**.
2. Elige el proveedor, pega la clave y elige el modelo.
3. (Opcional) Marca **Enable fallback** y elige el segundo proveedor.
4. Pulsa **TEST CONNECTION**. Hace una llamada real: si sale `ONLINE`, funciona.

> **Sobre el selector de modelos de NVIDIA NIM:** lista todo el catálogo del
> proveedor, pero no todos los modelos son invocables con tu cuenta — algunos
> responden `404`. Por eso el botón **TEST CONNECTION** existe: confirma el
> modelo concreto que has elegido antes de dejarlo en producción.

### Dar acceso a n8n

Los workflows necesitan un token para llamar a la API del Automation Center:

1. En la misma pantalla → **Automation token** → **Generate**.
2. Cópialo (**se muestra una sola vez**) y ponlo en `.env`:
   ```
   AC_API_URL=http://backend:8080
   AC_SERVICE_TOKEN=acs_...
   ```
3. Aplica: `docker compose up -d`

> En un despliegue en la nube, `AC_API_URL` es la URL pública del backend
> **con esquema**, p. ej. `https://automation-center-api.onrender.com`.

Comprobar de punta a punta (sustituye la URL y el token):
```bash
curl -s -X POST "$AC_API_URL/api/ai/generate" -H "X-AC-Service-Token: $AC_SERVICE_TOKEN" -H "Content-Type: application/json" -d '{"prompt":"di hola"}'
```
Una respuesta con `"text"` y `"provider"` = OK.

---

## 2. Telegram — en el panel, sin copiar ningún chat id

**Lo normal (y lo único necesario):**

1. En Telegram, habla con **@BotFather** → `/newbot` → nombre y usuario del bot.
   Te da un token tipo `8123456:AAE...`.
2. Panel → **Integraciones → Telegram** → pega el token.
3. Pulsa el enlace que aparece y luego **Start** en Telegram. El chat se vincula
   solo; no hay chat id que copiar.
4. **Send a test** en el panel: debe llegarte un mensaje.

Desde ese momento los **cuatro asistentes de serie** (Email, Laboral, Noticias,
Marca Personal) y los **avisos de fallo** te escriben por ese bot: n8n llama a
`POST /api/automations/notify` con el token de servicio y el backend envía por la
conexión del panel. El token del bot está cifrado en PostgreSQL y **n8n no lo
ve nunca**.

**Opcional — un bot propio por asistente.** Si prefieres que cada asistente
escriba desde su propio bot (para silenciarlos por separado), en el launcher →
**Ajustes** rellena el token de ese asistente y el chat id:

| Variable | Asistente |
|---|---|
| `TELEGRAM_TOKEN_EMAIL` | Email |
| `TELEGRAM_TOKEN_LABORAL` | Laboral |
| `TELEGRAM_NOTICIAS_TOKEN` | Noticias |
| `TELEGRAM_TOKEN_MARCA` | Marca Personal |
| `TELEGRAM_TOKEN_ALERTAS` | Avisos de fallo (si no, el primero de los cuatro) |
| `TELEGRAM_CHAT_ID` | Común a todos: escribe a tu bot y abre `https://api.telegram.org/bot<TOKEN>/getUpdates` → `"chat":{"id":…}` |

Las reglas, iguales en los cinco workflows:

- **token + chat id** → ese asistente usa su bot propio;
- **ni token ni nada** → usa el Telegram del panel;
- **token sin chat id** (o un token mal copiado) → el workflow se para con
  *Configuración incompleta* y te dice qué falta. Nunca cambia de canal a escondidas.

Avanzado: si tienes un servidor propio de la Bot API
([telegram-bot-api](https://github.com/tdlib/telegram-bot-api)), el backend lo
usa con `AC_TELEGRAM_API_URL=http://tu-servidor:8081`.

---

## 3. Google OAuth (Gmail + Calendar) — solo para el workflow **Email**

Este es el único que necesita OAuth. Los workflows de Noticias, Marca Personal y
Laboral **no lo necesitan**.

### 3.1 Crear las credenciales en Google Cloud

1. <https://console.cloud.google.com/> → crea un proyecto (p. ej. "asistente-tdr").
2. **APIs y servicios → Biblioteca**: activa **Gmail API** y **Google Calendar API**.
3. **APIs y servicios → Pantalla de consentimiento OAuth**:
   - Tipo: **Externo**.
   - Rellena nombre de la app y tu correo.
   - **Usuarios de prueba**: añade tu propia dirección Gmail. (Con la app en modo
     "Testing" no necesitas verificación de Google.)
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **URI de redirección autorizados**: aquí va la que te dé n8n en el paso
     siguiente, normalmente:
     `http://localhost:5678/rest/oauth2-credential/callback`
   - Copia el **Client ID** y el **Client secret**.

### 3.2 Darlas de alta en n8n

1. Abre <http://localhost:5678> → **Credentials → New**.
2. Crea una credencial **"Google Calendar OAuth2 API"**:
   - Pega Client ID y Client secret.
   - n8n muestra la **OAuth Redirect URL** exacta → cópiala y pégala en Google
     Cloud (paso 3.1.4) si no coincide.
   - Pulsa **Connect / Sign in with Google** y acepta los permisos.
3. Crea otra credencial **"Gmail OAuth2"** igual (puedes reutilizar el mismo
   Client ID/secret).
4. Abre el workflow **«Asistente - Email»**:
   - Nodos **Correo nuevo (Gmail)** y **Gmail - Correos recientes (prueba)** →
     selecciona la credencial Gmail.
   - Nodo **Google Calendar - Crear evento** → selecciona la credencial Calendar
     (apunta a `primary`). Viene **desactivado**: actívalo cuando quieras que
     cree eventos en tu calendario.
5. Pulsa **Execute workflow** para probar con los últimos correos no leídos.
6. Si va bien, **activa** el workflow.

> Alcances (scopes) que pedirá: lectura de Gmail y gestión de eventos de
> Calendar. Puedes revocarlos cuando quieras en
> <https://myaccount.google.com/permissions>.

---

## 4. Avisos de fallo — «Sistema - Gestor de errores»

Los cuatro asistentes tienen como *Error workflow* a `00-error-handler.json`.
Cuando cualquiera falla:

1. registra el fallo en la actividad del panel (`POST /api/automations/events`,
   autenticado con `AC_SERVICE_TOKEN`);
2. avisa por Telegram con el workflow, el nodo, el error y un enlace a la
   ejecución: por el Telegram del panel o, si hay un bot propio en el launcher
   (`TELEGRAM_TOKEN_ALERTAS` o el primero de los cuatro, con `TELEGRAM_CHAT_ID`),
   por ese. El mismo fallo se avisa como mucho **una vez por hora**.

No hace falta activarlo: n8n lo ejecuta solo cuando otro workflow falla.

Cada asistente empieza además por un nodo **Comprobar configuracion** que,
si falta una variable, falla con un mensaje que dice cuál y dónde se pone
(p. ej. `AC_PROFILE_ID (launcher > Ajustes > ID del perfil activo)`, o un bot
propio con token pero sin `TELEGRAM_CHAT_ID`).

---

## Scraper de empleo (workflow Laboral) — nota

El workflow Laboral usa el servicio `playwright` incluido, que hace scraping de
las **páginas públicas de LinkedIn** (sin login). Si LinkedIn bloquea el acceso
anónimo, cae automáticamente a la API pública de **arbeitnow.com** para no
quedarse sin datos.

Para scraping fiable de LinkedIn con tu sesión iniciada (cookies) o de InfoJobs,
esa parte se añade más adelante; no requiere cambios en los workflows, solo en el
servicio `playwright/`.

---

## Checklist rápida

- [ ] Proveedor de IA configurado en el panel y **TEST CONNECTION** en verde
- [ ] `.env` con `AC_API_URL` y `AC_SERVICE_TOKEN` reales
- [ ] Telegram conectado en el panel (Integraciones → Telegram → **Send a test**)
- [ ] `docker compose up -d` tras editar `.env`
- [ ] Workflow **Noticias** probado → llega a Telegram → activado
- [ ] Workflow **Marca Personal** probado → borradores en `output/marca-personal/` → activado
- [ ] Workflow **Laboral** probado → ofertas a Telegram → activado
- [ ] (opcional) Google OAuth para **Email** → probado → activado
- [ ] Panel → **Credentials**: todo lo verificable en *Ready*
