# Arquitectura de la aplicación Windows

Este documento describe **la capa de escritorio**: qué instala el `.exe`, quién
arranca qué y dónde vive cada cosa. La arquitectura interna de la plataforma
(backend, modelo de salud, credenciales, proveedores de IA, workflows) está en
[../ARCHITECTURE.md](../ARCHITECTURE.md) y no cambia por ejecutarse en local.

## Las cuatro capas

```
  Personal-Assistant-Setup.exe        Inno Setup 6
          │                           copia el codigo y lanza el bootstrap
          ▼
  bootstrap.ps1                       DETECTA → WSL2 → DOCKER → DESPLIEGA →
          │                           HEALTH CHECKS → READY
          ▼
  install.ps1                         .env, puertos, build, up, BD,
          │                           migraciones, workflows, arranque automatico
          ▼
  docker compose                      postgres · n8n · playwright · backend ·
                                      frontend · profile
```

Encima de eso, para el uso diario:

```
  launcher.ps1        ventana de estado y control     ┐
  tray.ps1            icono de bandeja                ├─► control.ps1 ─► docker compose
  Menu Inicio         accesos directos                ┘
  Tarea PersonalAssistant (al iniciar sesion)  ─────────► control.ps1 start
```

Todo lo que arranca, para o reinicia servicios pasa por **`control.ps1`**. No
hay una segunda ruta que invoque `docker compose` por su cuenta: el acceso
directo, el launcher, la bandeja y la tarea programada llaman al mismo sitio.

## Quién sabe qué

| Componente | Responsabilidad | Lo que NO hace |
|---|---|---|
| `PersonalAssistant.iss` | copiar la lista blanca de ficheros, accesos directos, registro, invocar el bootstrap | nada de lógica de negocio |
| `bootstrap.ps1` | orquestar el primer arranque, elevar solo lo que lo necesita, reanudar tras reiniciar | desplegar (delega en `install.ps1`) |
| `install.ps1` | `.env`, puertos libres, build, `up`, crear la BD, migraciones, importar workflows, health checks | preguntar nada al usuario |
| `control.ps1` | start / stop / restart / status / open / logs | borrar datos |
| `launcher.ps1` | mostrar estado real y ofrecer las acciones | sondear servicios por su cuenta |
| `lib.ps1` | rutas, logging redactado, estado, Docker, puertos, health checks | conocer Windows (eso es `common.ps1`) |

## Estado: una sola fuente

El launcher **no** tiene sondas propias. Pregunta:

1. `GET /api/health` — el backend y su conexión a la base de datos.
2. `GET /api/system/status` — `services_probe.py`: postgres, n8n, playwright,
   profile y el proveedor de IA, con el mismo modelo de estados que pinta el
   panel (`online`, `configured`, `degraded`, `invalid`, `offline`,
   `not_configured`, `unknown`).

Solo cuando el backend todavía no responde cae al estado del contenedor
(`docker inspect`), y entonces distingue «parado» de «arrancando» en vez de
quedarse en blanco. Es deliberado que la ventana y el panel digan lo mismo: dos
implementaciones de la misma comprobación acaban discrepando.

## Código y datos

Separados a propósito, porque el directorio de instalación puede ser
`C:\Program Files\...` y no es escribible:

| | |
|---|---|
| Código | `Program Files\Personal Assistant\` — solo lectura |
| Datos | `%LOCALAPPDATA%\Personal Assistant\` — `.env`, `config\`, `data\`, `output\`, `logs\`, `backups\` |

Como ya no comparten directorio, `docker compose` no puede deducir nada del
directorio actual. `Get-ApComposeArgs` añade a **todas** las llamadas:

```
-f <instalacion>\docker-compose.yml
--project-directory <instalacion>
--env-file <datos>\.env
```

El nombre del proyecto lo fija `name:` dentro del propio compose, así que los
contenedores y los volúmenes se llaman igual venga la llamada de donde venga, y
una instalación nueva adopta el stack existente en vez de duplicarlo.

Solo dos montajes necesitan escritura y son los únicos parametrizados:
`PA_CONFIG_DIR` y `PA_OUTPUT_DIR`. `workflows\` y `scripts\db-init\` se montan
de solo lectura y se quedan junto al código, porque son parte de la aplicación.

## Red

| Servicio | Puerto publicado | Alcance |
|---|---|---|
| frontend | `127.0.0.1:3000` | solo esta máquina |
| backend | `127.0.0.1:8080` | solo esta máquina |
| n8n | `127.0.0.1:5678` | solo esta máquina |
| profile | `127.0.0.1:7777` | solo esta máquina |
| postgres | — | red interna de Docker |
| playwright | — | red interna de Docker |

Si un puerto está ocupado, el instalador elige otro libre, lo guarda en el
`.env` y reescribe `VITE_API_URL` / `VITE_WS_URL` para que el panel siga
apuntando al backend correcto.

Ningún servicio se publica en `0.0.0.0`. n8n ejecuta código arbitrario por
diseño: exponerlo a la red local sería el fallo de seguridad más caro de todo el
sistema, y hay una prueba que lo impide en `installer\tests\Test-Installer.ps1`.

## Qué entra en el `.exe`

Lista blanca explícita en `[Files]`, no lista de exclusiones: el
`docker-compose.yml`, los cuatro contextos de build, los workflows, el esquema
SQL, los scripts del instalador y la documentación. Inno emite
`dist\Setup-Manifest.txt` con la lista exacta, y `build\verify-package.ps1` la
audita —y, con `-Extract`, audita también el árbol realmente instalado.

Nunca se empaqueta `.env`, `*.pem`, `*.key`, `.git`, `.claude`, worktrees,
`.venv`, `node_modules`, `__pycache__` ni nada de la raíz que no esté listado.

## La capa del asistente (v3.0)

Encima de la capa de escritorio, la v3 añade lo que hace que el producto se
sienta como un asistente y no como un panel de n8n. Todo vive en el backend
(`backend/app/services/`) y reutiliza lo que ya había: el Integrations Hub para
tokens, `AIService` para el modelo y n8n solo para ejecutar automatizaciones.

```
 Web (React)  ─┐                       ┌─ Gmail / Calendar (OAuth + PKCE, Hub)
 Telegram bot ─┼─►  assistant.py  ─────┼─ AI provider (Gemini / NIM / OpenRouter)
 Ctrl+K / chat ┘    │                  └─ n8n (solo ejecuta)
                    ├─ priority.py   prioridad LOW/NORMAL/HIGH/URGENT con motivos
                    ├─ memory.py     preferencias, remitentes, notas (sin secretos)
                    ├─ tasks.py      tareas y fechas límite
                    ├─ demo.py       día de ejemplo para presentaciones
                    └─ trust.py      privacidad, seguridad, salud del sistema
```

| Módulo | Qué decide | Datos que guarda |
|---|---|---|
| `priority.py` | Cuánto importa un correo **para ti** y por qué. Puntuación transparente (remitente conocido +35, fecha límite +20, urgencia +20, acción +15, no-reply −25…), no una segunda llamada al modelo | nada |
| `memory.py` | Preferencias validadas, remitentes importantes, notas. Rechaza cualquier cosa que parezca una contraseña, token o tarjeta | tabla `assistant_memory` |
| `tasks.py` | Tareas extraídas de correos o creadas a mano; idempotente por correo | tabla `assistant_tasks` |
| `assistant.py` | Lista/lee/analiza correo, borradores en 4 tonos, envío en el mismo hilo, archivar, briefing 2.0, insights, `ask` (respuestas estructuradas), sugerencias, bot de Telegram | caché de prioridad en `assistant_memory` (nivel y fecha, nunca el texto) |
| `demo.py` | Datos coherentes: 5 correos, 3 eventos, 1 fecha límite, 4 automatizaciones, 2 ejecuciones, 1 error | nada (en memoria) |
| `trust.py` | Qué ve la IA, quién tiene acceso, estado de seguridad | nada |

**Persona en el bucle.** El flujo es siempre *proponer → la persona confirma →
el sistema ejecuta*. Enviar un correo, archivar y desconectar piden
confirmación en la web y, en Telegram, con botones `[Enviar] [Editar]
[Cancelar]`. Una confirmación pendiente caduca a los 15 minutos y solo se puede
usar una vez.

**Un solo modelo de datos nuevo.** La migración `0005_assistant_memory_tasks` es
aditiva (dos tablas, nada se altera ni se borra). Integraciones, credenciales,
automatizaciones y ejecuciones **no** necesitaron tablas nuevas: ya estaban en
`credentials`, `workflows` y n8n. Las notificaciones se derivan de
`system_events` y de los *insights*.

**Telegram.** El bot hace *polling* (`getUpdates`) con el offset guardado en la
conexión, así funciona en local sin URL pública. Solo responde al chat
vinculado y atiende botones solo en ese chat. El briefing automático se envía
una vez al día a la hora elegida.

**Sin streaming.** El backend responde de una vez (no hay endpoint de
streaming); el chat muestra un estado de carga y un *Stop* que cancela de verdad
la petición. No se simula escritura progresiva.

**Sistema de diseño.** Tokens centralizados en `frontend/src/index.css`: colores
(`--c-*`, tema oscuro y claro, contrastes ≥ 4.5:1), sombras, movimiento
(`--motion-*`), apilamiento (`--z-*`) y radios; Tailwind los expone
(`z-overlay`, `duration-base`…). `prefers-reduced-motion` se respeta.
