; ===========================================================================
;  Personal Assistant - instalador Windows (Inno Setup 6)
;  Produce: Personal-Assistant-Setup.exe
;
;  Compilar:
;     ISCC.exe /DAppVersion=3.0.0 installer\windows\PersonalAssistant.iss
;  (build\build-exe.ps1 lee VERSION y pasa /DAppVersion automáticamente.)
;
;  El .exe empaqueta la LISTA BLANCA de [Files] (docker-compose + los cuatro
;  contextos de build + workflows + scripts; nunca .env, *.pem, .claude ni
;  worktrees) y, tras copiar los ficheros, ejecuta
;  installer\windows\scripts\bootstrap.ps1  (DETECTA -> WSL2 -> DOCKER ->
;  DESPLIEGA -> HEALTH CHECKS). No hay lógica de negocio en este .iss.
;
;  Los datos del usuario NO se instalan aquí: viven en
;  %LOCALAPPDATA%\Personal Assistant (ver installer\lib.ps1).
; ===========================================================================

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#define AppName "Personal Assistant"
#define AppPublisher "Personal Assistant"
#define RepoRoot "..\.."
#define ScriptsDir "{app}\installer\windows\scripts"
#define PwShell "{sys}\WindowsPowerShell\v1.0\powershell.exe"

[Setup]
; El AppId NO cambia al renombrar el producto: es su identidad para Windows.
; Cambiarlo dejaria huerfana la entrada de "Agregar o quitar programas" de la
; version anterior y la nueva instalacion no se reconoceria como actualizacion.
AppId={{7F1C4E9A-3B2D-4A56-9E10-AC0DEC0DE001}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Personal Assistant
DefaultGroupName=Personal Assistant
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir={#RepoRoot}\dist
OutputBaseFilename=Personal-Assistant-Setup
; Lista de TODO lo que entra en el .exe. build\verify-package.ps1 la audita
; (ningun *.pem, .claude\, worktree, .venv ni web.py puede aparecer aqui).
OutputManifestFile=Setup-Manifest.txt
SetupIconFile=assets\personal-assistant.ico
UninstallDisplayIcon={app}\installer\windows\assets\personal-assistant.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; x86 / 32-bit NO soportado. Solo x64 y ARM64.
ArchitecturesAllowed=x64compatible arm64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=no
MinVersion=10.0.19041
DisableDirPage=auto

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "runsetup"; Description: "Preparar el entorno y arrancar ahora (WSL2, Docker, servicios)"; GroupDescription: "Primer arranque:"
Name: "trayautostart"; Description: "Iniciar el icono de bandeja al iniciar sesión"; GroupDescription: "Extras:"
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Extras:"; Flags: unchecked

[Files]
; ---------------------------------------------------------------------------
;  LISTA BLANCA. Se empaqueta EXCLUSIVAMENTE lo que el producto necesita para
;  arrancar: docker-compose, los cuatro contextos de build, los workflows, el
;  esquema SQL, los scripts del instalador y la documentacion de usuario.
;
;  Antes esto era una sola entrada `Source: "{#RepoRoot}\*"` con una lista de
;  exclusiones, y esa lista no cubria *.pem, .claude\ (13 worktrees completos
;  del repositorio) ni web.py. Una lista negra falla en silencio en cuanto
;  aparece un fichero nuevo en la raiz; una lista blanca falla de forma
;  ruidosa, que es lo que queremos en un artefacto que se distribuye.
;  build\verify-package.ps1 comprueba el .exe ya compilado.
;
;  NUNCA se empaqueta:  *.pem *.key *.p12 *.pfx id_rsa* .env .git .claude
;                       worktrees .venv node_modules __pycache__ dist
;                       ni nada de la raiz que no este listado aqui.
;  El Excludes de cada entrada recursiva repite la regla por si acaso.
; ---------------------------------------------------------------------------
#define NeverShip "*.pem,*.key,*.p12,*.pfx,id_rsa*,.env,.env.local,.env.backup*,.git,.claude,worktrees,node_modules,__pycache__,*.pyc,.pytest_cache,.venv,venv,*.egg-info,.coverage,htmlcov,*.log"

; --- raiz: solo los ficheros que el stack lee en tiempo de ejecucion ---
Source: "{#RepoRoot}\docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\VERSION";            DestDir: "{app}"; Flags: ignoreversion
; El .dockerignore de la raiz es el del contexto de build del backend: es lo
; que mantiene .env y *.pem fuera del demonio de Docker. Sin el, un
; `docker compose build` enviaria los secretos al daemon.
Source: "{#RepoRoot}\.dockerignore";      DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\.env.example";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\README.md";          DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\INSTALL.md";         DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\CREDENCIALES.md";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\ARCHITECTURE.md";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\DEVELOPMENT.md";     DestDir: "{app}"; Flags: ignoreversion

; --- contextos de build de Docker ---
Source: "{#RepoRoot}\backend\*";    DestDir: "{app}\backend";    Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "{#NeverShip}"
Source: "{#RepoRoot}\frontend\*";   DestDir: "{app}\frontend";   Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "{#NeverShip},dist,coverage,.vercel"
Source: "{#RepoRoot}\playwright\*"; DestDir: "{app}\playwright"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "{#NeverShip}"
Source: "{#RepoRoot}\profile\*";    DestDir: "{app}\profile";    Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "{#NeverShip}"

; --- plantillas de arranque (los datos vivos van al perfil del usuario) ---
Source: "{#RepoRoot}\config\modules.json";              DestDir: "{app}\config"; Flags: ignoreversion
Source: "{#RepoRoot}\config\user_profile.example.json"; DestDir: "{app}\config"; Flags: ignoreversion
Source: "{#RepoRoot}\workflows\*.json";                 DestDir: "{app}\workflows";      Flags: ignoreversion
Source: "{#RepoRoot}\scripts\db-init\*.sql";            DestDir: "{app}\scripts\db-init"; Flags: ignoreversion

; --- instalador y control de servicios ---
Source: "{#RepoRoot}\installer\lib.ps1";               DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#RepoRoot}\installer\install.ps1";           DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#RepoRoot}\installer\uninstall.ps1";         DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#RepoRoot}\installer\windows\scripts\*.ps1"; DestDir: "{app}\installer\windows\scripts"; Flags: ignoreversion
Source: "{#RepoRoot}\installer\windows\scripts\*.vbs"; DestDir: "{app}\installer\windows\scripts"; Flags: ignoreversion
Source: "{#RepoRoot}\installer\windows\assets\*";      DestDir: "{app}\installer\windows\assets"; Flags: ignoreversion

; --- documentacion de usuario ---
Source: "{#RepoRoot}\docs\*.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[Icons]
; El acceso directo principal abre el LAUNCHER (ventana de estado + control),
; no directamente el navegador: es lo que convierte esto en una aplicacion de
; escritorio y no en "una URL que hay que recordar".
;
; Se lanza con wscript + hidden.vbs porque powershell.exe -WindowStyle Hidden
; crea la consola y la oculta despues: se ve un parpadeo negro. hidden.vbs la
; crea ya oculta.
Name: "{group}\Personal Assistant";        Filename: "{sys}\wscript.exe"; Parameters: """{#ScriptsDir}\hidden.vbs"" ""{#ScriptsDir}\launcher.ps1"""; IconFilename: "{app}\installer\windows\assets\personal-assistant.ico"; Comment: "Abrir Personal Assistant"
Name: "{group}\Abrir el panel web";       Filename: "{#PwShell}"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" open"
Name: "{group}\Iniciar";                  Filename: "{#PwShell}"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" start"
Name: "{group}\Parar";                    Filename: "{#PwShell}"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" stop"
Name: "{group}\Reiniciar";                Filename: "{#PwShell}"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" restart"
Name: "{group}\Estado";                   Filename: "{#PwShell}"; Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" status"
Name: "{group}\Ver logs";                 Filename: "{#PwShell}"; Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{#ScriptsDir}\control.ps1"" logs"
Name: "{group}\Copia de seguridad";       Filename: "{#PwShell}"; Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{#ScriptsDir}\backup.ps1"""
Name: "{group}\Volver a ejecutar la instalación"; Filename: "{#PwShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{#ScriptsDir}\bootstrap.ps1"""
Name: "{group}\{cm:UninstallProgram,Personal Assistant}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Personal Assistant";  Filename: "{sys}\wscript.exe"; Parameters: """{#ScriptsDir}\hidden.vbs"" ""{#ScriptsDir}\launcher.ps1"""; IconFilename: "{app}\installer\windows\assets\personal-assistant.ico"; Tasks: desktopicon
Name: "{userstartup}\Personal Assistant Tray"; Filename: "{sys}\wscript.exe"; Parameters: """{#ScriptsDir}\hidden.vbs"" ""{#ScriptsDir}\tray.ps1"""; Tasks: trayautostart

[Registry]
Root: HKCU; Subkey: "Software\Personal Assistant"; ValueType: string; ValueName: "Version";    ValueData: "{#AppVersion}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Personal Assistant"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"
; Rastro del nombre anterior: se elimina al desinstalar, no se crea nunca.
Root: HKCU; Subkey: "Software\Automation Center"; Flags: dontcreatekey uninsdeletekey

[Run]
; runhidden: el usuario no ve ninguna ventana de PowerShell durante la
; preparacion del entorno. El progreso se sigue en la barra del asistente
; (StatusMsg) y, con detalle, en
; %LOCALAPPDATA%\Personal Assistant\logs\install.log.
Filename: "{#PwShell}"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{#ScriptsDir}\bootstrap.ps1"" {code:BootstrapArgs}"; \
  WorkingDir: "{app}"; Flags: runascurrentuser waituntilterminated runhidden; \
  StatusMsg: "Preparando el entorno: WSL2, Docker, base de datos, n8n, Playwright y el panel. La primera vez descarga varios GB y puede tardar 15-25 minutos..."; \
  Tasks: runsetup; Check: not WizardSilent

; La pregunta sobre los datos NO se hace desde [UninstallRun]: en la practica
; esas entradas no llegaron a ejecutarse (el log del desinstalador pasa
; directo a borrar registro y ficheros, sin un solo "Running Exec"). Se hace
; desde CurUninstallStepChanged, en [Code], que si corre y ademas lo hace
; ANTES de borrar los ficheros del script.
[Code]
var
  GNeedRestart: Boolean;
  GPriorDir: String;

// La instalacion nunca pregunta nada por consola: -Unattended va siempre.
// En modo silencioso ademas no se abre el navegador al terminar.
function BootstrapArgs(Param: String): String;
begin
  Result := '-Unattended';
  if WizardSilent then
    Result := '-Unattended -SkipBrowser';
end;

// --- Detección de instalación previa (upgrade) --------------------------
function InitializeSetup(): Boolean;
begin
  Result := True;
  GNeedRestart := False;
  // La subclave se llamaba 'Automation Center' hasta la v0.4.x. Se consulta
  // tambien la antigua: de ella depende que una actualizacion haga backup y
  // pare los servicios antes de sobrescribir ficheros.
  if not RegQueryStringValue(HKCU, 'Software\Personal Assistant', 'InstallDir', GPriorDir) then
    RegQueryStringValue(HKCU, 'Software\Automation Center', 'InstallDir', GPriorDir);
  if (GPriorDir <> '') and DirExists(GPriorDir) then
    Log('Instalación previa detectada en ' + GPriorDir);
end;

// --- Antes de sobrescribir ficheros: backup + parar (solo en upgrade) --
procedure CurStepChanged(CurStep: TSetupStep);
var
  RC: Integer;
  DockerScript: String;
begin
  if (CurStep = ssInstall) and (GPriorDir <> '') and DirExists(GPriorDir) then
  begin
    DockerScript := GPriorDir + '\installer\windows\scripts';
    if FileExists(DockerScript + '\backup.ps1') then
    begin
      Log('Upgrade: creando backup previo y parando servicios...');
      Exec(ExpandConstant('{#PwShell}'),
        '-NoProfile -ExecutionPolicy Bypass -File "' + DockerScript + '\backup.ps1" -Label pre-upgrade',
        '', SW_SHOW, ewWaitUntilTerminated, RC);
      Exec(ExpandConstant('{#PwShell}'),
        '-NoProfile -ExecutionPolicy Bypass -File "' + DockerScript + '\control.ps1" stop',
        '', SW_HIDE, ewWaitUntilTerminated, RC);
    end;
  end;

  if CurStep = ssPostInstall then
  begin
    if not WizardIsTaskSelected('runsetup') then exit;
    // bootstrap.ps1 lo ejecuta la sección [Run]; aquí solo capturamos su
    // resultado cuando corre en modo silencioso.
    if WizardSilent then
    begin
      Exec(ExpandConstant('{#PwShell}'),
        '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{#ScriptsDir}') + '\bootstrap.ps1" -Unattended -SkipBrowser',
        ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, RC);
      if RC = 10 then GNeedRestart := True;
    end;
  end;
end;

// La sección [Run] no propaga el exit code; comprobamos RunOnce como señal
// de "reinicio pendiente" al terminar el asistente.
function NeedRestart(): Boolean;
var
  Dummy: String;
begin
  Result := GNeedRestart or
    RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'PersonalAssistantSetupResume', Dummy);
end;

// --- Desinstalacion: preguntar SIEMPRE que hacer con los datos ---------
// usUninstall se ejecuta antes de borrar ficheros, asi que uninstall.ps1
// todavia existe. En modo silencioso se CONSERVAN los datos: nunca se borra
// nada del usuario sin que lo haya pedido explicitamente.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  RC: Integer;
  Mode, Script: String;
begin
  if CurUninstallStep <> usUninstall then exit;
  Script := ExpandConstant('{app}\installer\windows\scripts\uninstall.ps1');
  if not FileExists(Script) then exit;
  if UninstallSilent then
    Mode := '-Mode KeepData -Silent'
  else
    Mode := '-Mode Ask';
  Exec(ExpandConstant('{#PwShell}'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" ' + Mode,
    '', SW_HIDE, ewWaitUntilTerminated, RC);
end;
