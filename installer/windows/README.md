# Instalador Windows — `Personal-Assistant-Setup.exe`

Instalador nativo hecho con **Inno Setup 6**. Empaqueta todo el repositorio
(docker-compose + backend + frontend + workflows + scripts) en un único `.exe`
y, tras copiar los ficheros, ejecuta `scripts\bootstrap.ps1`:

```
DETECTA  →  WSL2  →  DOCKER DESKTOP  →  DESPLIEGA (docker compose)
        →  BD automation_center  →  MIGRACIONES  →  WORKFLOWS
        →  HEALTH CHECKS  →  READY
```

No hay lógica de negocio en el `.iss`. El despliegue real lo hace
`installer/install.ps1` (el mismo que usa el paquete portable), así que
Windows y Linux comparten el flujo.

## Estructura

```
installer/windows/
├── PersonalAssistant.iss        script de Inno Setup
├── assets/personal-assistant.ico icono
└── scripts/
    ├── common.ps1      helpers (reutiliza installer/lib.ps1) + WSL/elevación
    ├── detect.ps1      detección de requisitos (idempotente, sin efectos)  [-Json]
    ├── install-wsl.ps1 habilita WSL2 + VirtualMachinePlatform (+ distro)   [admin]
    ├── install-docker.ps1 instala/arranca Docker Desktop (winget u oficial)[admin si instala]
    ├── bootstrap.ps1   orquestador (lo lanza el .exe)
    ├── control.ps1     start | stop | restart | status | open | logs
    ├── backup.ps1      copia de seguridad (no destructiva)
    ├── restore.ps1     restauración (nunca DROP DATABASE)
    ├── tray.ps1        icono de bandeja (NotifyIcon)
    └── uninstall.ps1   desinstalación con elección conservar/borrar datos
```

## Compilar

Requisito: **Inno Setup 6** (`winget install JRSoftware.InnoSetup`).

```powershell
powershell -File build\build-exe.ps1
```

Lee `VERSION`, lo pasa como `/DAppVersion`, compila y escribe:

```
dist\Personal-Assistant-Setup.exe
dist\Personal-Assistant-Setup.exe.sha256
```

En CI: `.github/workflows/release.yml` job `windows-exe` (Inno vía `choco`,
compila, instala/desinstala en silencio para verificar, firma si hay
certificado). Se dispara al empujar un tag `vX.Y.Z`.

## Modos de ejecución del `.exe`

| Uso | Comando |
|---|---|
| Interactivo (doble clic) | asistente gráfico; al final ejecuta el bootstrap |
| Desatendido | `Personal-Assistant-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES` |
| Solo copiar ficheros (sin tocar Docker/WSL) | añade `/TASKS="!runsetup,!trayautostart"` |
| Cambiar carpeta | `/DIR="C:\Ruta"` |
| Log detallado | `/LOG="C:\setup.log"` |

## Reinicio

Si Windows necesita reiniciar para activar la virtualización, `bootstrap.ps1`
registra una entrada **RunOnce** (`PersonalAssistantSetupResume`) y sale con
código 10. Tras reiniciar e iniciar sesión, la instalación **continúa sola**.

## Qué necesita Internet

- **Primera** instalación: descarga de imágenes Docker (postgres, n8n, node,
  nginx, alpine) y build del backend/frontend/playwright.
- Docker Desktop / la distro WSL, **solo si no están ya instalados**.
- Reinstalar, actualizar, backup, restore y arrancar/parar: **offline**.

## Seguridad

- Los secretos (`POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `AC_JWT_SECRET`,
  `AC_CREDENTIAL_ENCRYPTION_KEY`) se generan en la instalación con RNG
  criptográfico y se escriben solo en `.env` (permisos de usuario, en
  `.gitignore`). No se muestran ni se registran (el log los enmascara).
- El instalador **nunca** ejecuta `DROP DATABASE` ni `docker compose down -v`
  salvo que elijas explícitamente "borrar todos los datos" al desinstalar.
- Puertos publicados solo en `127.0.0.1`. Postgres no se publica al host.
