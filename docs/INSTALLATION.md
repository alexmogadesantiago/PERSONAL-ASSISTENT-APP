# Instalación de Automation Center

`DESCARGAR → EJECUTAR → INSTALACIÓN AUTOMÁTICA → LOGIN → DASHBOARD`

## Arquitectura

```
WEB (Vercel)                         LOCAL (este instalador)
Browser → Vercel → Backend remoto    Browser → localhost:3000 → Backend local
                → PostgreSQL/n8n              → Docker (postgres, n8n,
                                                playwright, backend, frontend)
```

El instalador Windows despliega la parte **LOCAL**. El frontend en Vercel es
independiente y no se toca aquí.

## Plataformas soportadas (v0.4.0)

El **Automation Center** (backend + panel) se instala **solo en Windows
x64/ARM64** en v0.4.0.

|         | Automation Center | Stack Fase 1 (n8n/Postgres/…) |
|---------|-------------------|------------------------------|
| Windows 10 (2004+) / 11 · x64 · ARM64 | ✅ `AutomationCenter-Setup.exe` | ✅ |
| Linux x64 / ARM64 | ❌ (no portado) | ✅ `installer/install.sh` |
| Raspberry Pi OS 64-bit | ❌ (no portado) | ✅ `installer/install.sh` |

`installer/install.sh` no crea la BD `automation_center`, no aplica migraciones
Alembic y no levanta `pa-backend` / `pa-frontend`. No se soporta x86/32-bit ni
ARM32/ARMv7.

## Windows — con `AutomationCenter-Setup.exe`

1. Descarga `AutomationCenter-Setup.exe` (de la [release](../.github/workflows/release.yml)).
2. Doble clic. El asistente:
   - comprueba Windows, arquitectura, RAM y disco;
   - **WSL2**: si falta, habilita `Microsoft-Windows-Subsystem-Linux` y
     `VirtualMachinePlatform`, fija WSL v2 e instala Ubuntu. Si Windows pide
     reiniciar, lo detecta y **continúa solo tras el reinicio** (RunOnce);
   - **Docker Desktop**: si falta, lo instala (winget o instalador oficial),
     lo arranca y espera a `docker info` + `docker compose`. Si ya está, lo
     reutiliza (no toca tus contenedores);
   - genera `.env` con secretos criptográficos;
   - `docker compose build` + `up`;
   - crea la BD `automation_center` (si no existe — nunca `DROP`);
   - aplica migraciones (`alembic upgrade head`, en el arranque del backend);
   - importa los 4 workflows (upsert por id: no duplica);
   - health checks reales de los 6 contenedores + HTTP de backend/frontend/n8n;
   - registra el arranque automático y (opcional) el icono de bandeja.
3. Al terminar abre `http://localhost:3000`. Crea la cuenta (**el primer
   usuario es admin**) y conecta credenciales.

### Desatendido

```powershell
AutomationCenter-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES
```

Los secretos externos (proveedor de IA, Telegram) se rellenan luego desde el
panel o en `.env`, según
el panel. Con `installer\install.ps1 -Unattended -ConfigFile secrets.json`
se pueden inyectar en la instalación.

## Paquete portable

```powershell
# Windows (stack completo, incl. Automation Center): doble clic en
# AutomationPlatform-Setup.cmd  (o)
powershell -ExecutionPolicy Bypass -File installer\install.ps1
```
```sh
# Linux / Raspberry Pi: SOLO stack Fase 1 (sin Automation Center)
./installer/install.sh
sudo dpkg -i automation-platform-<v>-<arch>.deb && sudo automation-platform-install
```

## Requisitos que gestiona el instalador

| Dependencia | Si ya está | Si falta (Windows) |
|---|---|---|
| WSL2 + distro Linux | se reutiliza | se habilita/instala (puede requerir 1 reinicio) |
| Docker Desktop | se reutiliza (versión + `docker info`) | se instala en silencio |
| Docker Compose v2 | se comprueba | viene con Docker Desktop |
| PostgreSQL, n8n, Playwright, Backend, Frontend | contenedores del `docker-compose.yml` | los levanta el instalador |

## URLs (todo en `127.0.0.1`)

| URL | Servicio |
|---|---|
| http://localhost:3000 | **Automation Center** (panel) |
| http://localhost:8080/api/health | API (backend) |
| http://localhost:5678 | n8n (workflows) |
| http://localhost:7777 | editor de perfil |

Si un puerto está ocupado, el instalador elige otro y lo guarda en `.env`.

## Primer arranque: configurar sin tocar ficheros

Desde la v0.5 **no hace falta editar `.env`** para el uso normal. Al abrir el
panel por primera vez ve a **Setup** (menú lateral) y sigue los seis pasos:

```
WELCOME  ->  PROFILE  ->  SERVICES  ->  AUTOMATIONS  ->  SYSTEM CHECK  ->  READY
```

Ningún paso se marca a mano: cada uno lee el estado real del sistema, y READY
solo aparece cuando la comprobación pasa de verdad.

### PROFILE

Las automatizaciones filtran y puntúan contra tu perfil. Se guarda en
PostgreSQL y el monitor lo marca `CONFIGURED` solo cuando los campos mínimos
llevan datos reales:

| Campo | Claves aceptadas |
|---|---|
| Profesión | `profesion`, `sector`, `objetivo_profesional`, `formacion` |
| Ubicación | `ubicacion`, `ubicacion_laboral`, `localizacion` |
| Intereses | `intereses`, `temas`, `topics` |
| Preferencias | `preferencias`, `preferencias_laborales`, `preferencias_noticias`, `modalidad`, `automatizaciones` |

Un perfil creado pero vacío, o con los desplegables sin tocar (`[]`), **no**
cuenta como configurado: marcarlo en verde mandaría a los workflows a filtrar
sin criterio.

### SERVICES

En **Ajustes → Servicios** (o en el paso Services del asistente) apuntas la
plataforma a tus propias instancias:

| Servicio | Necesita | Dónde se obtiene |
|---|---|---|
| **n8n** | URL pública + API key | La URL de tu n8n; la key en n8n → Settings → n8n API |
| **Playwright** | URL | El sidecar de scraping (en local: `http://playwright:3000`) |
| **NVIDIA NIM** (IA recomendada) | API key | <https://build.nvidia.com> |
| **OpenRouter** (IA alternativa) | API key | <https://openrouter.ai/keys> |
| **Gemini** (IA opcional) | API key | <https://aistudio.google.com/app/apikey> |

Lo que guardes aquí se cifra en PostgreSQL y **tiene prioridad sobre las
variables de entorno**. Se aplica en la siguiente comprobación de salud
(≤ 5 s): sin reinicio y sin redespliegue. La clave nunca vuelve al navegador;
el panel solo muestra una pista tipo `...a3f9`.

Cada tarjeta tiene **Test connection**, que ejecuta exactamente la misma sonda
que el monitor — un test en verde y un panel en verde no pueden discrepar.

### SYSTEM CHECK

El botón **Check services** de `/monitoring` fuerza una comprobación real sin
caché. Estados posibles:

| Estado | Significado |
|---|---|
| `ONLINE` | responde |
| `CONFIGURED` | configurado y verificado, pero no es algo que se pueda "pinguear" (perfil, clave de IA aceptada) |
| `DEGRADED` | responde pero solo funciona a medias (n8n vivo que rechaza la API key) |
| `INVALID` | credenciales rechazadas por el proveedor |
| `OFFLINE` | configurado pero no responde |
| `NOT_CONFIGURED` | no hay nada configurado aquí. **No es un error** |

`NOT_CONFIGURED` nunca pone la plataforma en `degraded`: un despliegue que solo
tiene backend no está roto.

## Gestión (sin PowerShell)

Menú Inicio → **Automation Center**:

- **Automation Center** — abre el panel
- **Iniciar / Parar / Reiniciar / Estado**
- **Ver logs**
- **Copia de seguridad**
- **Volver a ejecutar la instalación**
- **Desinstalar**

Icono de bandeja (si lo activaste): mismo menú + estado ● Running/Stopped.

## Estado y logs

- Estado reanudable: `%LOCALAPPDATA%\AutomationPlatform\state.json`
- Log (sin secretos): `%LOCALAPPDATA%\AutomationPlatform\install.log`
- Log del `.exe`: pásale `/LOG="C:\ruta\setup.log"`

## Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| "Docker Desktop is installed but not running" | Abre Docker Desktop, espera a que diga *Running*, reintenta. |
| Se queda en "esperando al motor de Docker" | Primer arranque de Docker tras instalar: puede tardar 1–2 min; a veces hace falta cerrar sesión y volver a entrar (grupo `docker-users`). |
| "REINICIO NECESARIO" | Reinicia; la instalación continúa sola al iniciar sesión. |
| Un contenedor no llega a `healthy` | `docker compose logs <servicio>` desde la carpeta de instalación, o menú → Ver logs. |
| `workflow_entity ≠ 4` | Revisa `docker compose logs n8n`. Los 4 IDs esperados: `0ikHqQCWMke67aoI`, `pa01email000001`, `pa02laboral00001`, `pa04marcapersonal`. |
| Puerto ocupado | El instalador remapea y lo anota en `.env`; mira la línea `n8n:… backend:…` del log. |
| El panel no abre | `http://localhost:3000` — comprueba `pa-frontend` en el menú → Estado. |
| Todo sale `NOT_CONFIGURED` | Normal si solo has desplegado el backend. Configúralo en Ajustes → Servicios. |
| n8n sale `DEGRADED` | Es alcanzable pero rechaza la API key. Genérala de nuevo en n8n → Settings → n8n API y vuelve a guardarla en el panel. |
| Al guardar una clave sale 503 | Falta `AC_CREDENTIAL_ENCRYPTION_KEY`. Sin ella no se puede cifrar nada. |
| **AI** sale `INVALID` | El proveedor configurado rechaza la clave (no es un fallo de red). Compruébala en su consola y vuelve a probar desde Settings → Artificial Intelligence. |
| **AI** sale `DEGRADED` | El proveedor principal está caído y responde el de respaldo. Las automatizaciones siguen funcionando. |
| PROFILE sigue en `NOT_CONFIGURED` | El perfil existe pero le faltan campos. Setup → Profile los lista uno a uno. |
| El estado no cambia tras configurar | El veredicto está cacheado. Pulsa **Check services**. |

Detalle de actualización y backup: [UPGRADE.md](UPGRADE.md) ·
[BACKUP-RESTORE.md](BACKUP-RESTORE.md).
