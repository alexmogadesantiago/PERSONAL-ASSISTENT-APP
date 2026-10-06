# Personal Assistant

**Un asistente personal con IA que vive en tu PC.** Lee tu correo y te dice qué importa (y por qué), conoce tu calendario y tus fechas límite, te propone acciones que **tú confirmas**, te habla por Telegram y automatiza tareas con n8n sin que tengas que abrir n8n.

Todo corre **en local** (Windows + Docker). Sin cloud, sin SaaS, sin suscripciones. Tus credenciales y tus datos no salen de tu equipo.

```
   Gmail · Calendar                 ┌───────────────────────────────┐
        │                           │  Panel web      localhost:3000│
        ▼                           │  Backend (API)  localhost:8082│
 ┌──────────────┐   propone    ┌────┴──────────┐                    │
 │  Tu bandeja  │ ───────────► │  Personal     │ ◄── tú confirmas   │
 │  y tu agenda │              │  Assistant    │                    │
 └──────────────┘ ◄─────────── │  + IA (Gemini)│ ──► n8n ──► Telegram
      ejecuta tras tu "sí"     └────┬──────────┘   (motor)   (te avisa)
                                    │ PostgreSQL · Docker · tu PC   │
                                    └───────────────────────────────┘
```

> **Estado:** v3.0. Funciona y está muy probado con servicios simulados; **Gmail y Gemini aún no se han probado con cuentas reales** (ver [Qué está probado](#qué-está-probado-y-qué-no)).

---

## Qué hace

| | |
|---|---|
| **Command Center** | La portada responde a: ¿qué pasa hoy?, ¿qué debería hacer?, ¿hay algún problema? Barra para pedirle cosas al asistente, tus correos importantes, eventos, fechas límite, el estado de cada servicio y *insights* con un botón de acción. |
| **Correo inteligente** | Analiza cada correo con IA: prioridad **LOW / NORMAL / HIGH / URGENT** *explicando el porqué* ("remitente importante · fecha límite en 48 h · requiere respuesta"), categoría, resumen y fechas. Detecta tareas, las convierte en recordatorios de Calendar y redacta respuestas en 4 tonos. **Nunca envía nada sin tu confirmación.** |
| **Calendar** | Tus próximos días y un formulario para crear eventos en tu Google Calendar. |
| **Chat del asistente** | Pregúntale "¿qué tengo pendiente hoy?" y responde con **tarjetas y botones** (correo, calendario, fechas límite), no solo texto. |
| **Telegram** | Un bot que es una extensión real del asistente: comandos y lenguaje natural. Solo responde a tu chat. Las respuestas a correos pasan por `[Enviar] [Editar] [Cancelar]`. |
| **Briefing diario** | El resumen de tu día, bajo demanda, en la portada y automático en Telegram a la hora que elijas. |
| **Automatizaciones** | Descríbelas en lenguaje natural ("cuando me escriba mi profesor, analízalo y avísame si es importante") o parte de una plantilla. Se ejecutan en n8n, que no necesitas abrir. Cada una muestra su salud. |
| **Todo bajo control** | Hub de integraciones con OAuth, qué permisos usa cada servicio, qué dejaría de funcionar si desconectas, Error Center con causa e impacto, reintento inteligente, memoria editable del asistente, tareas, y pantallas de **Privacidad** y **Seguridad**. |
| **Modo demo** | Un día de ejemplo (5 correos, 3 eventos, 1 fecha límite, 4 automatizaciones…) para enseñar el producto sin exponer tu correo. Nada se envía. |

---

## Instalación

**Requisito:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y abierto (Windows 10/11, x64 o ARM64). Es lo único que no puede ir dentro del instalador.

1. **Descarga** `Personal-Assistant-Setup-Full.exe` desde [Releases](../../releases) (~1,3 GB: lleva todo dentro, instala **sin internet** y sin compilar).
   - ¿Prefieres uno pequeño? `Personal-Assistant-Setup.exe` (~2,6 MB) construye las imágenes en el primer arranque y necesita internet.
2. **Ejecútalo** (doble clic). Windows SmartScreen puede avisar porque el instalador no está firmado: *Más información → Ejecutar de todos modos*.
3. **Abre el panel:** <http://localhost:3000> y crea tu cuenta (la primera es administradora).

Si ya tenías una versión instalada, **se actualiza encima**: hace antes un backup `pre-upgrade` y no toca tus datos.
Detalle, desinstalación y recuperación: [docs/INSTALLATION.md](docs/INSTALLATION.md) · [docs/UPGRADE.md](docs/UPGRADE.md) · [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md).

### Direcciones (solo accesibles desde tu equipo)

| URL | Qué es |
|---|---|
| <http://localhost:3000> | **El panel** (aquí vives tú) |
| <http://localhost:8082> | API del backend |
| <http://localhost:5678> | n8n (el motor; no hace falta abrirlo) |
| <http://localhost:7777> | Editor de perfil de los asistentes de serie |

---

## Conecta tus servicios (5 minutos, una sola vez)

Se hace desde **Integraciones** en el panel. Nada de editar ficheros ni copiar tokens a mano.

**1. Google (Gmail + Calendar)** — necesita una app OAuth tuya, porque Google lo exige a cada instalación:
1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crea un proyecto y activa las APIs de **Gmail** y **Google Calendar**.
2. *Credenciales → Crear → ID de cliente de OAuth → Aplicación web.*
3. En **URI de redirección autorizados** pon exactamente: `http://localhost:8082/api/integrations/google/callback`
4. Copia el *Client ID* y el *Client secret* en el panel: **Integraciones → Google → Avanzado**.
5. Pulsa **Conectar**, marca Gmail y Calendar y acepta. Si Google muestra "app no verificada", añade tu cuenta como usuario de prueba → *Avanzado → Continuar*.

**2. IA** — **Ajustes → AI**: elige proveedor (Gemini, NVIDIA NIM u OpenRouter), pega la clave y pulsa *Test connection*. Claves: [Gemini](https://aistudio.google.com/app/apikey) · [NVIDIA NIM](https://build.nvidia.com) · [OpenRouter](https://openrouter.ai/keys).

**3. Telegram** — crea un bot con [@BotFather](https://t.me/BotFather), pega su token en **Integraciones → Telegram** y pulsa **Start** en Telegram. No hay chat id que copiar.

El panel te guía en cada paso y te dice exactamente qué falta si algo no está conectado. Todo lo que pegas se guarda **cifrado** y nunca vuelve al navegador.

> ¿Solo quieres verlo? **Ajustes → Demo mode** llena el panel de datos de ejemplo sin conectar nada.

---

## Cómo se usa

- **Home:** pregunta en la barra ("¿qué tengo hoy?", "resume mis correos", "¿qué ha fallado?") o pulsa una tarjeta. Cada servicio tiene su botón: *Connect*, *Allow*, *Open* o *Reconnect*.
- **Inbox:** filtra por lo que ha encontrado la IA (requiere acción, fecha límite, remitente importante). Abre un correo → *Analyze with AI*, mira **por qué** tiene esa prioridad, crea la tarea o el evento, redacta la respuesta, edítala y confírmala.
- **Automatizaciones:** *New automation* → escribe lo que quieres o elige una plantilla (Email Assistant, Daily Briefing, Important Email Alert, Deadline Detector, Email Summarizer). Desde un correo: *Automatizar correos de este remitente*.
- **Atajos:** `Ctrl K` busca correos, tareas, ejecuciones, errores y ajustes · `Ctrl /` lista los atajos · `G` luego `H`/`I`/`A`/`T` va a Home/Inbox/Automatizaciones/Integraciones.

### El bot de Telegram

| Comando | Qué hace |
|---|---|
| `/emails` | Correos sin leer (🔴 urgente, 🟠 alta) |
| `/reply N` | Prepara una respuesta al correo N y **te la enseña antes de enviar** |
| `/briefing` | El resumen de tu día |
| `/tasks` · `/automations` | Tus tareas y fechas límite · tus automatizaciones |
| `/errors` · `/status` | Qué falla · estado general |

También entiende frases: *"¿qué tengo hoy?"*, *"¿tengo algún correo urgente?"*, *"hazme el briefing"*.

---

## Seguridad y privacidad

- **Tú decides.** La IA propone; tú confirmas; el sistema ejecuta. Enviar un correo, archivar o desconectar siempre piden confirmación (en la web y en Telegram). El asistente **no puede borrar correos**.
- **Credenciales cifradas** (Fernet) en tu PostgreSQL; el navegador solo ve los últimos 4 caracteres. OAuth 2.0 con PKCE, permisos de mínimo privilegio y revocables.
- **Lo que ve la IA** es lo necesario para cada función (remitente, asunto y texto del correo que analizas; títulos de eventos…). **Nunca** contraseñas, tokens, adjuntos ni correos que no abres. La lista exacta, con tu configuración real, está en **Ajustes → Privacy**.
- **Local:** credenciales, tareas, memoria, definiciones de automatizaciones e historial viven en tu equipo. Sin telemetría.
- **Telegram:** el bot solo atiende a tu chat vinculado.

Detalle y riesgos conocidos: [docs/SECURITY.md](docs/SECURITY.md).

---

## Qué está probado (y qué no)

| Nivel | Resultado |
|---|---|
| Backend | **574** tests ✅ |
| Frontend | **178** tests ✅ (tipos y lint limpios) |
| Instalador | **120** tests ✅ |
| Flujos de punta a punta (login → conectar Google → leer → analizar → redactar → confirmar envío → Telegram → automatizar → fallo y reintento) | ✅ con servicios **simulados** |
| Interfaz | revisada en el navegador sin desbordes de 375 a 1440 px |
| Servicios **reales** (solo lectura) | ✅ n8n · ✅ API de Telegram · ✅ migraciones en PostgreSQL |
| **Gmail real · Gemini real** · enviar mensajes por Telegram · cadena completa real | ⛔ **no probado** con cuentas reales |

Cuando conectes tus servicios, `python scripts/real-check.py --api http://localhost:8082 --user tu@correo` hace esa validación en **solo lectura** y marca cada paso `PASS`, `FAIL` o `SKIP` (no conectado = no se afirma nada). Nunca imprime asuntos, cuerpos ni claves.
Más en [docs/TESTING.md](docs/TESTING.md).

---

## Si algo no va

| Síntoma | Qué hacer |
|---|---|
| El instalador dice "Docker no está instalado / no arranca" | Instala y abre **Docker Desktop**, espera a que diga *running* y vuelve a ejecutarlo. Es reanudable. |
| El panel no abre en `localhost:3000` | `docker ps` debe mostrar 6 contenedores `pa-*` *healthy*. Si faltan: `docker compose up -d` en la carpeta de instalación. |
| "Connect Google" dice que falta la app OAuth | Haz el paso 1 de [Conecta tus servicios](#conecta-tus-servicios-5-minutos-una-sola-vez) (la app se registra una vez). |
| Google: *redirect_uri_mismatch* | El URI debe ser exactamente `http://localhost:8082/api/integrations/google/callback`. |
| Algo se rompió tras actualizar | Hay un backup en `%LOCALAPPDATA%\Personal Assistant\backups\`; ver [docs/UPGRADE.md](docs/UPGRADE.md#rollback). |
| No hay datos y solo quiero verlo | **Ajustes → Demo mode**. |

El **Error Center** del panel explica cada fallo en lenguaje claro y da el botón que lo arregla.

---

## Para desarrolladores

```
backend/      FastAPI + SQLAlchemy + Alembic (PostgreSQL; SQLite en tests)
frontend/     React 18 + Vite + Tailwind + React Query
workflows/    n8n: los 4 asistentes de serie + el gestor de errores
playwright/   servicio de scraping de empleo        profile/  editor de perfil
installer/    instalador Windows (Inno Setup + PowerShell)   build/  scripts de empaquetado
docs/         documentación   scripts/real-check.py   validación con servicios reales
```

```bash
cd backend  && python -m pytest                    # 574 tests
cd frontend && npm test && npm run lint && npm run typecheck && npm run build
powershell -File installer/tests/Test-Installer.ps1
powershell -File build/build-exe.ps1               # instalador ligero
powershell -File build/build-offline.ps1           # instalador completo (todo dentro)
powershell -File build/publish-release.ps1 -DryRun # preparar la Release de GitHub
```

Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md) (plataforma) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (escritorio y capa del asistente) · [DEVELOPMENT.md](DEVELOPMENT.md).

### Los 4 asistentes de serie (n8n)

Además de todo lo anterior, vienen cuatro workflows listos (se activan desde el panel o desde n8n):

| Workflow | Qué hace | Programación |
|---|---|---|
| **Laboral** | scraping de ofertas → filtro y scoring → TOP 3 por Telegram | 07:30 |
| **Noticias** | Google News según tus intereses → resumen con IA | 08:00 |
| **Marca Personal** | novedades de IA → borrador de post de LinkedIn | 08:15 |
| **Email** | clasifica y resume tu Gmail, crea eventos de Calendar | continuo |

**Deuda conocida:** estos cuatro envían a Telegram con sus **propios bots**, configurados en el launcher, y no con la conexión del panel. Funcionan igual que siempre; el análisis y el plan para unificarlo están en [docs/V3-AUDIT.md](docs/V3-AUDIT.md#los-4-asistentes-de-serie-y-telegram). Qué credencial necesita cada uno: [CREDENCIALES.md](CREDENCIALES.md).

---

## Documentación

| Documento | Para qué |
|---|---|
| [docs/DEPLOYMENT-LOCAL.md](docs/DEPLOYMENT-LOCAL.md) | **Empieza aquí**: instalar, usar, actualizar y desinstalar |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Gmail, IA, Telegram y n8n: cómo se conectan y qué permisos usan |
| [docs/SECURITY.md](docs/SECURITY.md) | Credenciales, confirmaciones, qué ve la IA, riesgos conocidos |
| [docs/DEMO.md](docs/DEMO.md) | Modo demo, vista de presentación y guion de 5 minutos para el TDR |
| [docs/TESTING.md](docs/TESTING.md) | Niveles de prueba y qué se ha probado con servicios reales |
| [docs/V3-AUDIT.md](docs/V3-AUDIT.md) | Auditoría de la v2.0, decisiones de la v3.0 e informe final |
| [docs/PRODUCT-REDESIGN.md](docs/PRODUCT-REDESIGN.md) | Historia del rediseño del producto, versión a versión |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) · [docs/UPGRADE.md](docs/UPGRADE.md) · [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) | Instalación, actualización y copias de seguridad |
| [docs/CLOUD-DEPLOYMENT.md](docs/CLOUD-DEPLOYMENT.md) | Opcional: alojarlo en la nube en vez de en local |

---

## Qué NO incluye (a propósito)

Cloud/SaaS, registro contra un servidor remoto, auto-actualizaciones OTA y análisis de uso. Es una aplicación **personal y local**.
