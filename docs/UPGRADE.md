# Actualizar Automation Center

## Fuente de versión

Única: el fichero **`VERSION`** en la raíz. De ahí salen backend
(`app.__version__`, `/api/health`), frontend (`package.json`), el instalador
(`/DAppVersion`) y las imágenes Docker.

Versión instalada: registro `HKCU\Software\Automation Center\Version`
(o menú → Estado, o `GET /api/health`).

## Con el `.exe`

Ejecuta el `AutomationCenter-Setup.exe` de la versión nueva **sobre la
instalación existente**. El instalador:

1. detecta la instalación previa (registro `InstallDir`);
2. **crea un backup** `pre-upgrade` (`backup.ps1 -Label pre-upgrade`);
3. **para** los servicios (`control.ps1 stop`);
4. sustituye los ficheros del programa (no toca `.env` ni `config/user_profile.json`);
5. `docker compose build` + `up` con las imágenes/código nuevos;
6. aplica **solo las migraciones pendientes** (`alembic upgrade head` es no-op
   si ya está al día; en una BD nueva corre `0001 → 0002 → 0003 → …`);
7. reimporta los 5 workflows (upsert por id — no duplica, no borra);
8. health checks. Si alguno falla, termina en **BLOCKED** y el log indica qué.

Los volúmenes (`personal-assistant_postgres_data`, `…_n8n_data`) se conservan
siempre. Nunca hay `DROP DATABASE` ni `down -v`.

## Rollback

Si la actualización deja el sistema mal:

```powershell
# 1. localiza el backup pre-upgrade
dir %LOCALAPPDATA%\AutomationPlatform\backups

# 2. restaura (BD del backend + ficheros locales)
powershell -File "<InstallDir>\installer\windows\scripts\restore.ps1" ^
  -Path "%LOCALAPPDATA%\AutomationPlatform\backups\<timestamp>-pre-upgrade"
```

`restore.ps1` hace además un backup `pre-restore` antes de tocar nada.
Para volver también a la versión anterior del código, reinstala el `.exe`
antiguo y luego restaura.

## Manual (paquete portable / Linux)

```sh
git pull                 # o descomprime el paquete nuevo encima
./installer/windows/scripts/backup.ps1   # Windows
docker compose stop
docker compose up -d --build
# alembic corre solo en el arranque del backend
docker compose exec backend alembic current
```

## Comprobación post-actualización

```
docker compose ps                 # 6 servicios "healthy"
curl http://localhost:8080/api/health   # "version": "<nueva>"
# workflow_entity sigue siendo 4, mismos IDs
```
