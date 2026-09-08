# Producción local en Windows

Personal Assistant se instala y se ejecuta **entero en el PC del usuario**. No
hay ninguna dependencia de AWS, Oracle Cloud ni Render en la ruta normal: el
panel, el backend, PostgreSQL, n8n y Playwright viven en contenedores Docker
sobre esta máquina y solo escuchan en `127.0.0.1`.

```
                    Personal Assistant
                            │
     ┌──────────────────────┴──────────────────────┐
     │                                             │
  Launcher (WinForms)                        Panel web
  estado + arranque/parada                http://127.0.0.1:3000
     │                                             │
     └──────────────► docker compose ◄─────────────┘
                            │
   ┌──────────┬─────────────┼──────────────┬───────────────┐
   │          │             │              │               │
 backend   postgres        n8n         playwright       frontend
  :8080   (red interna)   :5678       (red interna)      :3000
```

Solo cuatro puertos se publican al host, y los cuatro atados a `127.0.0.1`:
`3000` (panel), `8080` (API), `5678` (n8n) y `7777` (editor de perfil).
PostgreSQL y Playwright **no publican ninguno**: se hablan por la red interna
de Docker. Otra máquina de la red no puede alcanzarlos.

---

## Código y datos están separados

| | Dónde | Qué hay |
|---|---|---|
| **Código** | `C:\Program Files\Personal Assistant\` (o `%LOCALAPPDATA%\Programs\Personal Assistant\` si se instala sin permisos de administrador) | docker-compose, los contextos de build, los workflows, los scripts. **Solo lectura: nunca se escribe nada aquí.** |
| **Datos** | `%LOCALAPPDATA%\Personal Assistant\` | todo lo que cambia |

```
%LOCALAPPDATA%\Personal Assistant\
  .env          secretos y puertos
  config\       modules.json + user_profile.json   (montado en n8n y en profile)
  data\         estado del instalador + README.txt
  output\       borradores que generan los workflows
  logs\         install.log, launcher.log, backend.log, n8n.log, ...
  backups\      copias de seguridad con marca de tiempo
```

El `.env` está en la raíz del directorio de datos y **no** dentro de `config\`
a propósito: `config\` se monta dentro de n8n, que ejecuta código de usuario en
sus nodos Code, y el `.env` contiene todas las claves de cifrado del sistema.

### Dónde está realmente la base de datos

En volúmenes con nombre de Docker, no en un directorio de Windows:

```
personal-assistant_postgres_data   la BD de n8n y la de automation_center
personal-assistant_n8n_data        credenciales cifradas y ajustes de n8n
```

Es deliberado. PostgreSQL sobre un *bind mount* de Windows da problemas de
permisos y de `fsync`; un volumen con nombre es más rápido y sobrevive igual a
parar, reiniciar, actualizar y desinstalar conservando los datos. Para tener
esos datos como ficheros, usa **Copia de seguridad**: el resultado aparece en
`backups\`.

---

## Uso diario

| Quiero... | Cómo |
|---|---|
| Abrir la aplicación | Menú Inicio → **Personal Assistant** (abre el launcher) |
| Ver si todo funciona | El launcher muestra cada servicio con su estado real |
| Abrir el panel | Botón **Abrir panel**, o el icono de bandeja |
| Arrancar / parar / reiniciar | Botones del launcher, o el icono de bandeja |
| Ver los logs | Botón **Ver logs**: abre `logs\` y refresca el volcado de los contenedores |
| Meter los tokens de Telegram | Botón **Ajustes** del launcher |
| Copia de seguridad | Menú Inicio → **Copia de seguridad** |

El launcher no reimplementa la monitorización: pregunta a `GET /api/health` y a
`GET /api/system/status`, que es `services_probe.py`, el mismo sondeo y los
mismos estados que ve el panel. Cuando el backend todavía no responde, cae al
estado del contenedor para poder decir «arrancando» en vez de quedarse en
blanco.

### Arranque con Windows

El instalador registra una tarea programada `PersonalAssistant` que ejecuta
`control.ps1 start` al iniciar sesión, con la ventana oculta. Si prefieres que
no arranque solo, desactívala en el Programador de tareas de Windows.

---

## Logs

Todo en `%LOCALAPPDATA%\Personal Assistant\logs\`:

| Fichero | Qué contiene |
|---|---|
| `install.log` | instalación, arranques, paradas |
| `launcher.log` | la ventana de escritorio |
| `backend.log`, `n8n.log`, `playwright.log`, `postgres.log`, `frontend.log`, `profile.log` | volcado de los logs del contenedor correspondiente |

Los de los contenedores se refrescan al pulsar **Ver logs** (o con
`control.ps1 logs`). Todo lo que se escribe pasa por un filtro de redacción:
contraseñas, API keys, tokens de Telegram y tokens de servicio se sustituyen por
un marcador. Los ficheros rotan a `.1` al pasar de 5 MB.

---

## Actualizar

Ejecuta el `Personal-Assistant-Setup.exe` nuevo sobre la instalación existente.
Antes de sobrescribir ficheros el instalador crea un backup `pre-upgrade` y para
los servicios.

**Una actualización no toca `%LOCALAPPDATA%\Personal Assistant\`.** El
instalador solo escribe en el directorio de instalación, y `.env`, `config\`,
`output\`, `logs\` y `backups\` no están ahí. Los volúmenes de Docker tampoco se
tocan: `docker compose up -d` reutiliza los que ya existen.

## Desinstalar

Desde «Agregar o quitar programas», o el acceso directo **Desinstalar Personal
Assistant**. Pregunta **siempre** qué hacer con los datos:

- **Conservar** — para los contenedores y deja intactos los volúmenes, el
  `.env`, la configuración, los borradores y los backups. Puedes reinstalar
  encima y seguir donde lo dejaste.
- **Eliminar también mis datos** — borra además los volúmenes de Docker.
  Irreversible.

Nunca borra datos en silencio: una desinstalación desatendida (`/VERYSILENT`)
elige *conservar*.

---

## Requisitos y qué instala el asistente

- Windows 10 (2004+) o Windows 11, **x64 o ARM64**. No hay soporte de 32 bits.
- WSL2 y Docker Desktop. Si faltan, el instalador los prepara él mismo. Si
  Windows pide reiniciar para activar la virtualización, el instalador registra
  la continuación y **sigue solo** tras el reinicio (RunOnce).
- La primera instalación descarga varios GB de imágenes (la de Playwright ya
  trae los navegadores: nunca hay que ejecutar `npx playwright install`) y puede
  tardar entre 15 y 25 minutos.

Docker Desktop es gratuito para uso personal y para empresas de menos de 250
empleados y menos de 10 M$ de ingresos; por encima de eso requiere licencia de
pago. Se eligió frente a instalar n8n y PostgreSQL de forma nativa porque el
aislamiento y la reproducibilidad compensan, y porque el propio instalador
automatiza su instalación.

---

## Generar el instalador

```powershell
powershell -File build\build-exe.ps1
```

Necesita Inno Setup 6 (`winget install JRSoftware.InnoSetup`). Produce
`dist\Personal-Assistant-Setup.exe`, su `.sha256` y `dist\Setup-Manifest.txt`
con la lista exacta de ficheros empaquetados.

Auditar el paquete antes de distribuirlo:

```powershell
powershell -File build\verify-package.ps1 -Extract
```

Comprueba el manifiesto y, además, instala el `.exe` en un directorio temporal y
audita el árbol resultante. Falla si aparece cualquier `*.pem`, `.env`,
`.claude\`, worktree, `.venv`, `node_modules` o `web.py`, y también si falta
algo imprescindible para arrancar.

Pruebas del instalador y del launcher (no necesitan Docker):

```powershell
powershell -File installer\tests\Test-Installer.ps1
```

---

## Problemas frecuentes

**El launcher dice que n8n está «Degradado»** — normalmente falta la API key de
n8n. El backend puede alcanzarlo pero no consultarlo. Se configura en el panel,
en Ajustes → Servicios.

**«BLOCKED BY: ya existe una base de datos de una instalación anterior»** — el
volumen `personal-assistant_postgres_data` guarda la contraseña con la que se
creó, y el instalador acaba de generar un `.env` nuevo. Copia tu `.env` anterior
a `%LOCALAPPDATA%\Personal Assistant\.env` y vuelve a ejecutar la instalación, o
borra el volumen si quieres empezar de cero (se pierden los datos). Es el caso
típico al instalar el `.exe` en una máquina donde el stack ya corría desde un
clon del repositorio.

**Docker Desktop no arranca** — ábrelo una vez a mano y vuelve a pulsar
**Iniciar servicios** en el launcher. El instalador lo intenta arrancar, pero no
puede saltarse un diálogo de licencia sin aceptar.

**SmartScreen avisa al abrir el instalador** — el `.exe` no está firmado. Hace
falta un certificado de firma de código; sin él Windows avisa siempre.

**La primera instalación parece colgada** — está descargando imágenes. Sigue el
avance en `%LOCALAPPDATA%\Personal Assistant\logs\install.log`.
