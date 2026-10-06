# Copia de seguridad y restauración

Scripts: `installer/windows/scripts/backup.ps1` y `restore.ps1`.
Menú Inicio → **Automation Center → Copia de seguridad**.

## Qué se guarda

`backup.ps1` crea `%LOCALAPPDATA%\AutomationPlatform\backups\<timestamp>[-etiqueta]\`:

| Fichero | Contenido |
|---|---|
| `automation_center.dump` | `pg_dump -Fc` de la BD del backend (usuarios, perfiles, credenciales cifradas, ejecuciones, eventos) |
| `n8n.dump` | `pg_dump -Fc` de la BD de n8n (**siempre se preserva**) |
| `n8n_data.tgz` | volumen de n8n: `config` (clave), credenciales cifradas, settings |
| `env` | copia de `.env` (secretos — ACL restringido al usuario) |
| `config/` | `user_profile.json` + catálogo |
| `workflows/` | los 5 workflows JSON (4 asistentes + gestor de errores) |
| `manifest.json` | versión, fechas, `workflow_entity`, checksums SHA-256 |

Los dumps se hacen con el stack **en marcha** (son consistentes). No hay
operaciones destructivas.

## Hacer un backup

```powershell
powershell -File installer\windows\scripts\backup.ps1
powershell -File installer\windows\scripts\backup.ps1 -Label antes-de-tocar-perfiles
powershell -File installer\windows\scripts\backup.ps1 -OutDir D:\backups
```

Recomendado antes de: actualizar, cambiar credenciales, experimentar con
workflows. La actualización con el `.exe` ya hace uno (`pre-upgrade`).

## Restaurar

```powershell
powershell -File installer\windows\scripts\restore.ps1 -Path "<carpeta-del-backup>"
```

Por defecto restaura **solo**:

- la BD `automation_center` (`pg_restore --clean --if-exists` — recrea las
  tablas dentro de la BD; **nunca `DROP DATABASE`**);
- `.env`, `config/`, `workflows/`.

Opciones:

| Flag | Efecto |
|---|---|
| `-RestoreN8nData` | restaura también el volumen `n8n_data.tgz` (credenciales/settings de n8n) |
| `-RestoreN8nDb` | restaura también la BD de n8n (workflows, credenciales, ejecuciones). **Peligroso**: sustituye el estado de n8n |
| `-Yes` | sin confirmación |

`restore.ps1` **siempre** hace un backup `pre-restore` antes de empezar, para
y arranca los servicios en el orden correcto y termina mostrando
`workflow_entity`.

## Restaurar en una máquina nueva

1. Instala con `AutomationCenter-Setup.exe` (deja que despliegue el stack).
2. Copia la carpeta del backup a la máquina nueva.
3. `restore.ps1 -Path <carpeta> -RestoreN8nData` (añade `-RestoreN8nDb` si
   quieres exactamente los mismos workflows/credenciales de n8n).

## Desinstalar sin perder datos

El desinstalador **pregunta**:

- **Conservar mis datos** → para los contenedores, conserva los volúmenes.
  Reinstalar recupera todo.
- **Borrar todo** (irreversible) → `docker compose down -v`.

Nunca se borra nada en silencio. En desinstalación silenciosa
(`/VERYSILENT`) se **conservan** los datos.
