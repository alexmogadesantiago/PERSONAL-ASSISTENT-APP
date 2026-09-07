# Personal Assistant

Asistente personal construido sobre **n8n** + **Postgres** + un servicio de
**scraping con Playwright** + un **editor de perfil web**, todo en contenedores
Docker. Cuatro automatizaciones:

| Workflow | Qué hace | Salida | Necesita |
|---|---|---|---|
| **Noticias** | feed de Google News según tus intereses → resumen con IA | Telegram | IA, Telegram |
| **Marca Personal** | novedades de IA/tecnología → borrador de post de LinkedIn con tu tono | ficheros `.md` + aviso Telegram | IA, Telegram |
| **Laboral** | scraping de ofertas (LinkedIn público / arbeitnow) → filtro + scoring + TOP 3 → por qué encaja | Telegram | IA, Telegram |
| **Email** | lee tu Gmail → clasifica, resume y crea eventos de Calendar | Telegram + Google Calendar | IA, Telegram, **Google OAuth** |

Los tres primeros funcionan solo con una clave de un proveedor de IA
(NVIDIA NIM, OpenRouter o Gemini) y un bot de Telegram.
El de Email necesita además OAuth de Google. Todo el detalle en
[CREDENCIALES.md](CREDENCIALES.md).

---

## Documentación

| Documento | Para qué |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Cómo encaja todo y por qué: componentes, configuración, modelo de salud, seguridad |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Instalación y primer arranque (asistente de configuración) |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Trabajar en el código: tests, migraciones, añadir integraciones |
| [docs/CLOUD-DEPLOYMENT.md](docs/CLOUD-DEPLOYMENT.md) | Despliegue Vercel + Render |
| [CREDENCIALES.md](CREDENCIALES.md) | Qué credencial necesita cada automatización |

## Configuración sin terminal

Desde la v0.5 la configuración normal se hace desde el panel, no editando
ficheros. Lo que guardes en **Ajustes → Servicios** (URL de n8n, API keys,
endpoint del scraper) se cifra en PostgreSQL, **tiene prioridad sobre las
variables de entorno** y se aplica en la siguiente comprobación de salud, sin
reiniciar ni redesplegar. Las variables `AC_*` siguen existiendo como valor por
defecto para arranques desatendidos (instalador, Docker, CI).

El panel distingue estados reales y no los inventa:

```
ONLINE          responde
CONFIGURED      configurado y verificado (perfil, clave de IA aceptada)
DEGRADED        responde pero solo a medias (n8n vivo que rechaza la API key)
INVALID         credenciales rechazadas por el proveedor
OFFLINE         configurado pero sin respuesta
NOT_CONFIGURED  no hay nada configurado aquí — no es un error
```

## Requisitos

- **Docker Desktop** (Windows x64/ARM64, Linux, macOS).
- Clave de un proveedor de IA. Recomendado **NVIDIA NIM**:
  <https://build.nvidia.com> (alternativas: <https://openrouter.ai/keys>,
  <https://aistudio.google.com/app/apikey>). Se configura desde el panel, en
  **Settings → Artificial Intelligence**.
- Un **bot de Telegram** (gratis): @BotFather.

---

## Puesta en marcha

**Windows (x64/ARM64):** doble clic en **`AutomationCenter-Setup.exe`**
(instalador nativo: detecta y prepara WSL2 + Docker Desktop, despliega el stack
completo incluido el panel Automation Center, health checks).
Alternativa sin `.exe`: `AutomationPlatform-Setup.cmd`.

**Linux / Raspberry Pi:** `./installer/install.sh` instala **solo** el stack
Fase 1 (n8n + Postgres + Playwright + editor de perfil). En v0.4.0 el
Automation Center (backend + panel web) es **solo Windows**. Ver
[INSTALL.md](INSTALL.md#plataformas-soportadas-v040).

Detalle: [docs/INSTALLATION.md](docs/INSTALLATION.md) ·
[installer/windows/README.md](installer/windows/README.md).

El instalador detecta la plataforma y la arquitectura, comprueba Docker, genera
`.env` (te pregunta las claves, o las deja pendientes), ajusta puertos, construye
y levanta los 4 servicios, importa los workflows, ejecuta health checks reales y
registra el arranque automático. Es **idempotente** y **reanudable**.
Detalle completo en [INSTALL.md](INSTALL.md).

(`scripts/setup.ps1` sigue funcionando: ahora es un alias de `installer/install.ps1`.)

Servicios (todos en localhost, solo accesibles desde tu equipo):

| URL | Qué es |
|---|---|
| http://localhost:5678 | n8n — los workflows |
| http://localhost:7777 | editor de perfil |

Luego:

1. Abre **http://localhost:5678** y crea la cuenta de propietario (local).
2. Verás los 4 workflows importados.
3. Ajusta tu perfil en **http://localhost:7777**.
4. Abre cada workflow y pulsa **Execute workflow** para probarlo.
5. Activa (toggle) los que quieras dejar en automático.

Si editas `.env` después de arrancar: `docker compose up -d` recrea los
contenedores con los nuevos valores.

---

## Horarios (cuando se activan)

| Workflow | Programación |
|---|---|
| Laboral | cada día 07:30 |
| Noticias | cada día 08:00 |
| Marca Personal | cada día 08:15 |
| Email | continuo (cada minuto revisa correos nuevos) |

Se cambian en el nodo *Schedule Trigger* / *Gmail Trigger* de cada workflow.

---

## Personalizar el perfil

Abre **http://localhost:7777** (servicio `profile`): una web para marcar tus
opciones sin tocar ficheros. Al guardar escribe `config/user_profile.json`, que
es lo que leen los workflows en cada ejecución (no hace falta reiniciar nada).

Qué influye en qué:

- **Idioma** + **Temas de noticias** → *Noticias* y *Marca Personal*
- **Estilo de marca personal** → tono de los borradores de *Marca Personal*
- **Formación** + **Sectores** + **Ubicación laboral** → búsqueda *Laboral*

También puedes editar `config/user_profile.json` a mano (ids válidos en
`config/modules.json`). El servicio expone además `GET /profile` con el perfil ya
resuelto (ids → valores) por si se quiere consumir por HTTP.

---

## Estructura

```
docker-compose.yml          postgres + n8n + playwright + profile
.env / .env.example         secretos (gitignored)
CREDENCIALES.md             cómo obtener cada API key / OAuth
config/
  modules.json              catálogo de opciones
  user_profile.json         tus selecciones (gitignored)
playwright/
  server.mjs + Dockerfile   servicio de scraping de empleo
profile/
  server.mjs                servicio + web para editar el perfil (:7777)
  public/index.html
  Dockerfile
scripts/
  setup.ps1                 arranque idempotente
  db-init/                  esquema SQL inicial
workflows/
  01-email.json  02-laboral.json  03-news.json  04-marca-personal.json
output/
  marca-personal/           borradores .md generados
```

---

## Comandos útiles

```bash
docker compose ps
docker compose logs -f n8n
docker compose logs -f playwright
docker compose logs -f profile
docker compose exec n8n n8n list:workflow
docker compose exec n8n n8n import:workflow --separate --input=/files/workflows   # reimportar
docker compose up -d --build   # reconstruir imágenes tras cambios
docker compose down            # parar (datos conservados)
docker compose down -v         # parar y BORRAR datos
```

---

## Qué NO incluye (a propósito)

Registro de máquina contra un control plane remoto y auto-updates OTA. El
resto (instalador `.exe` con WSL2/Docker automáticos, panel de control web,
backup/restore, actualización con rollback, CI de artefactos) sí está.
