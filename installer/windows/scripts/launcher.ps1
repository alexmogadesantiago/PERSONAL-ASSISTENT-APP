<#
.SYNOPSIS
  Personal Assistant - consola de escritorio de los servicios locales.

.DESCRIPTION
  Ventana nativa (WinForms) con el estado real de cada servicio y los botones
  para arrancarlos, pararlos, reiniciarlos, abrir el panel y ver los logs.

      PERSONAL ASSISTANT

      Backend        * Running
      Base de datos  * Running
      n8n            * Running
      Playwright     * Running
      Panel web      * Running

      [ Abrir panel ] [ Reiniciar ] [ Detener ] [ Ver logs ] [ Ajustes ]

  NO reimplementa la monitorizacion. El estado sale de donde ya vive:

    1. GET /api/health          -> el propio backend (y su conexion a la BD)
    2. GET /api/system/status   -> services_probe.py: postgres, n8n, playwright,
                                   profile y el proveedor de IA, con el mismo
                                   modelo de estados que usa el panel
                                   (online / configured / degraded / invalid /
                                   offline / not_configured / unknown)
    3. docker inspect           -> solo como respaldo cuando el backend todavia
                                   no responde; asi la ventana dice la verdad
                                   ("el contenedor esta arrancando") en vez de
                                   quedarse en blanco.

  Las acciones tampoco se duplican: delegan en control.ps1 (start/stop/restart/
  open/logs), el mismo camino que los accesos directos del menu Inicio y la
  tarea de arranque automatico.

  Se lanza sin consola:
      powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass
                     -File launcher.ps1

.PARAMETER NoAutoStart
  No intenta arrancar los servicios al abrir la ventana (solo observa).
#>
[CmdletBinding()]
param([switch] $NoAutoStart)

Set-StrictMode -Version Latest
# Una excepcion no controlada no debe cerrar la ventana del usuario.
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoRoot = Get-RepoRoot
$Version  = try { (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim() } catch { '' }

$envMap = Read-ApEnvMap $RepoRoot
function Get-EnvPort([string]$Key, [int]$Default) {
  if ($envMap.ContainsKey($Key) -and $envMap[$Key]) { return [int]$envMap[$Key] }
  return $Default
}
$FrontendPort = Get-EnvPort 'FRONTEND_PORT' 3000
$BackendPort  = Get-EnvPort 'BACKEND_PORT'  8080
$N8nPort      = Get-EnvPort 'N8N_PORT'      5678

$PanelUrl   = "http://127.0.0.1:$FrontendPort"
$HealthUrl  = "http://127.0.0.1:$BackendPort/api/health"
$StatusUrl  = "http://127.0.0.1:$BackendPort/api/system/status"

# --- Modelo de estado ------------------------------------------------------
# Las claves son las que enseña la ventana; 'probe' es el nombre que usa
# services_probe.py, y 'container' el contenedor que lo respalda.
$Rows = @(
  [ordered]@{ key = 'backend';    label = 'Backend';       probe = $null;        container = 'pa-backend' }
  [ordered]@{ key = 'postgres';   label = 'Base de datos'; probe = 'postgres';   container = 'pa-postgres' }
  [ordered]@{ key = 'n8n';        label = 'n8n';           probe = 'n8n';        container = 'pa-n8n' }
  [ordered]@{ key = 'playwright'; label = 'Playwright';    probe = 'playwright'; container = 'pa-playwright' }
  [ordered]@{ key = 'frontend';   label = 'Panel web';     probe = $null;        container = 'pa-frontend' }
)

# Estados de services_probe -> como se pintan aqui.
$StatusText = @{
  'online'         = 'Running'
  'configured'     = 'Configurado'
  'degraded'       = 'Degradado'
  'invalid'        = 'Credenciales rechazadas'
  'offline'        = 'Parado'
  'not_configured' = 'Sin configurar'
  'unknown'        = 'Desconocido'
  'starting'       = 'Arrancando...'
}
$StatusColor = @{
  'online'         = [System.Drawing.Color]::FromArgb(22, 140, 60)
  'configured'     = [System.Drawing.Color]::FromArgb(22, 140, 60)
  'degraded'       = [System.Drawing.Color]::FromArgb(190, 130, 0)
  'invalid'        = [System.Drawing.Color]::FromArgb(190, 130, 0)
  'offline'        = [System.Drawing.Color]::FromArgb(180, 50, 40)
  'not_configured' = [System.Drawing.Color]::FromArgb(120, 120, 120)
  'unknown'        = [System.Drawing.Color]::FromArgb(120, 120, 120)
  'starting'       = [System.Drawing.Color]::FromArgb(190, 130, 0)
}

function Invoke-Json {
  param([string] $Url, [int] $TimeoutSec = 3)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return ($r.Content | ConvertFrom-Json) }
  } catch { }
  return $null
}

# Respaldo cuando el backend no responde: el estado del contenedor no dice si
# el servicio funciona, pero si distingue "parado" de "arrancando".
function Get-ContainerFallbackStatus([string] $Name, [string] $DockerExe) {
  if (-not $DockerExe) { return 'unknown' }
  switch (Get-ApContainerState $DockerExe $Name) {
    'healthy'  { return 'online' }
    'running'  { return 'starting' }
    'starting' { return 'starting' }
    'unhealthy'{ return 'degraded' }
    'exited'   { return 'offline' }
    'created'  { return 'starting' }
    ''         { return 'offline' }
    default    { return 'unknown' }
  }
}

function Get-StackStatus {
  <#
    Devuelve una tabla clave -> @{ status; detail } para las filas de la ventana.
    Prioriza siempre la vista del backend (services_probe), que es la misma que
    ve el panel; solo cae al estado del contenedor cuando no hay backend.
  #>
  $result = @{}
  $docker = Get-DockerInfo
  $dockerExe = if ($docker.found -and $docker.running) { $docker.path } else { $null }

  $health = Invoke-Json $HealthUrl
  $status = if ($health) { Invoke-Json $StatusUrl } else { $null }

  foreach ($row in $Rows) {
    $st = 'unknown'; $detail = ''

    if ($row.key -eq 'backend') {
      if ($health) {
        $st = if ("$($health.status)" -eq 'ok') { 'online' } else { 'degraded' }
        $detail = if ("$($health.status)" -eq 'ok') { "v$($health.version)" }
                  else { ($health.problems -join '; ') }
        if (-not $detail) { $detail = "BD: $($health.database)" }
      } else {
        $st = Get-ContainerFallbackStatus $row.container $dockerExe
      }
    }
    elseif ($row.key -eq 'frontend') {
      if (Test-HttpHealthy "$PanelUrl/" 3) { $st = 'online'; $detail = $PanelUrl }
      else { $st = Get-ContainerFallbackStatus $row.container $dockerExe }
    }
    elseif ($status) {
      $svc = $status.services | Where-Object { $_.name -eq $row.probe } | Select-Object -First 1
      if ($svc) {
        $st = "$($svc.status)"
        $detail = "$($svc.detail)"
        if ($svc.latency_ms) { $detail = ('{0} ({1:N0} ms)' -f $detail, $svc.latency_ms) }
      } else {
        $st = Get-ContainerFallbackStatus $row.container $dockerExe
      }
    }
    else {
      $st = Get-ContainerFallbackStatus $row.container $dockerExe
      if ($st -ne 'offline') { $detail = 'esperando al backend' }
    }

    if (-not $StatusText.ContainsKey($st)) { $st = 'unknown' }
    $result[$row.key] = @{ status = $st; detail = $detail }
  }
  return $result
}

# --- Acciones: siempre a traves de control.ps1 ----------------------------
$script:Busy = $false
$script:Job  = $null

function Start-Control {
  param([ValidateSet('start','stop','restart')][string] $Action, [string] $Message)
  if ($script:Busy) { return }
  $script:Busy = $true
  Set-Banner $Message ([System.Drawing.Color]::FromArgb(190, 130, 0))
  $ctl = Join-Path $PSScriptRoot 'control.ps1'
  # Proceso aparte y oculto: la ventana sigue respondiendo y refrescando
  # mientras docker compose trabaja (puede tardar minutos la primera vez).
  $script:Job = Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$ctl`"", $Action)
}

# --- Ventana ---------------------------------------------------------------
$form               = New-Object System.Windows.Forms.Form
$form.Text          = 'Personal Assistant'
$form.ClientSize    = New-Object System.Drawing.Size(470, 360)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox   = $false
$form.BackColor     = [System.Drawing.Color]::White
$form.Font          = New-Object System.Drawing.Font('Segoe UI', 9)

$icoPath = Join-Path $PSScriptRoot '..\assets\personal-assistant.ico'
if (Test-Path $icoPath) { try { $form.Icon = New-Object System.Drawing.Icon $icoPath } catch { } }

$title = New-Object System.Windows.Forms.Label
$title.Text     = 'PERSONAL ASSISTANT'
$title.Font     = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(20, 16)
$title.Size     = New-Object System.Drawing.Size(340, 26)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text      = if ($Version) { "v$Version - todo se ejecuta en este equipo" } else { 'todo se ejecuta en este equipo' }
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(110, 110, 110)
$subtitle.Location  = New-Object System.Drawing.Point(22, 42)
$subtitle.Size      = New-Object System.Drawing.Size(420, 18)
$form.Controls.Add($subtitle)

# Filas de servicio
$script:RowControls = @{}
$y = 78
foreach ($row in $Rows) {
  $dot = New-Object System.Windows.Forms.Label
  $dot.Text      = [char]0x25CF          # circulo lleno
  $dot.Font      = New-Object System.Drawing.Font('Segoe UI', 12)
  $dot.ForeColor = $StatusColor['unknown']
  $dot.Location  = New-Object System.Drawing.Point(22, ($y - 3))
  $dot.Size      = New-Object System.Drawing.Size(18, 22)
  $form.Controls.Add($dot)

  $name = New-Object System.Windows.Forms.Label
  $name.Text     = $row.label
  $name.Location = New-Object System.Drawing.Point(44, $y)
  $name.Size     = New-Object System.Drawing.Size(110, 20)
  $form.Controls.Add($name)

  $state = New-Object System.Windows.Forms.Label
  $state.Text     = 'comprobando...'
  $state.Location = New-Object System.Drawing.Point(158, $y)
  $state.Size     = New-Object System.Drawing.Size(130, 20)
  $form.Controls.Add($state)

  $detail = New-Object System.Windows.Forms.Label
  $detail.ForeColor = [System.Drawing.Color]::FromArgb(120, 120, 120)
  $detail.Location  = New-Object System.Drawing.Point(292, $y)
  $detail.Size      = New-Object System.Drawing.Size(160, 20)
  $detail.AutoEllipsis = $true
  $form.Controls.Add($detail)

  $script:RowControls[$row.key] = @{ dot = $dot; state = $state; detail = $detail }
  $y += 30
}

# Linea de estado general
$banner = New-Object System.Windows.Forms.Label
$banner.Location  = New-Object System.Drawing.Point(22, ($y + 6))
$banner.Size      = New-Object System.Drawing.Size(424, 34)
$banner.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
$form.Controls.Add($banner)

function Set-Banner([string] $Text, $Color) {
  $banner.Text = $Text
  if ($Color) { $banner.ForeColor = $Color }
  else { $banner.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80) }
}

# Botones
function New-Button([string] $Text, [int] $X, [int] $Y, [int] $W, [scriptblock] $OnClick) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text     = $Text
  $b.Location = New-Object System.Drawing.Point($X, $Y)
  $b.Size     = New-Object System.Drawing.Size($W, 30)
  $b.FlatStyle = 'System'
  $b.Add_Click($OnClick)
  $form.Controls.Add($b)
  return $b
}

$by = $y + 48
$btnOpen = New-Button 'Abrir panel'  22  $by 110 { Start-Process $PanelUrl }
$btnRestart = New-Button 'Reiniciar' 140 $by 100 {
  Start-Control -Action 'restart' -Message 'Reiniciando los servicios...'
}
$btnStop = New-Button 'Detener'      248 $by 90 {
  Start-Control -Action 'stop' -Message 'Deteniendo los servicios (los datos se conservan)...'
}
$btnLogs = New-Button 'Ver logs'     346 $by 100 {
  # La carpeta se abre ya (respuesta inmediata) y el volcado de los logs de los
  # contenedores se refresca en segundo plano: son seis llamadas a docker y
  # bloquearian la ventana varios segundos.
  $dir = Get-ApLogDir
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Start-Process explorer.exe $dir
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$(Join-Path $PSScriptRoot 'control.ps1')`"", 'logs', '-NoOpen')
}

$by2 = $by + 38
$btnStart = New-Button 'Iniciar servicios' 22 $by2 130 {
  Start-Control -Action 'start' -Message 'Arrancando los servicios...'
}
$btnSettings = New-Button 'Ajustes' 160 $by2 100 { Show-SettingsDialog }
$btnN8n = New-Button 'Abrir n8n' 268 $by2 100 { Start-Process "http://127.0.0.1:$N8nPort" }

# --- Dialogo de ajustes: credenciales que consume n8n ---------------------
# Los workflows leen estos valores del entorno del contenedor de n8n, que sale
# del .env del directorio de datos. El almacen de credenciales del panel vive en
# Postgres y n8n no lo lee, asi que este es el unico sitio donde se pueden
# rellenar sin abrir un terminal.
function Show-SettingsDialog {
  $fields = @(
    @{ key = 'TELEGRAM_CHAT_ID';        label = 'Chat ID de Telegram';   secret = $false }
    @{ key = 'TELEGRAM_NOTICIAS_TOKEN'; label = 'Bot Noticias';          secret = $true }
    @{ key = 'TELEGRAM_TOKEN_MARCA';    label = 'Bot Marca Personal';    secret = $true }
    @{ key = 'TELEGRAM_TOKEN_LABORAL';  label = 'Bot Laboral';           secret = $true }
    @{ key = 'TELEGRAM_TOKEN_EMAIL';    label = 'Bot Email';             secret = $true }
  )
  $current = Read-ApEnvMap $RepoRoot

  $dlg = New-Object System.Windows.Forms.Form
  $dlg.Text = 'Personal Assistant - credenciales de Telegram'
  $dlg.ClientSize = New-Object System.Drawing.Size(470, 300)
  $dlg.StartPosition = 'CenterParent'
  $dlg.FormBorderStyle = 'FixedDialog'
  $dlg.MaximizeBox = $false; $dlg.MinimizeBox = $false
  $dlg.BackColor = [System.Drawing.Color]::White
  $dlg.Font = $form.Font

  $help = New-Object System.Windows.Forms.Label
  $help.Text = "Los tokens los da @BotFather. Deja un campo vacio para no tocarlo.`nNo se muestran los valores ya guardados."
  $help.Location = New-Object System.Drawing.Point(18, 12)
  $help.Size = New-Object System.Drawing.Size(430, 36)
  $help.ForeColor = [System.Drawing.Color]::FromArgb(110, 110, 110)
  $dlg.Controls.Add($help)

  $boxes = @{}
  $fy = 58
  foreach ($f in $fields) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $f.label
    $lbl.Location = New-Object System.Drawing.Point(18, ($fy + 3))
    $lbl.Size = New-Object System.Drawing.Size(150, 20)
    $dlg.Controls.Add($lbl)

    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Location = New-Object System.Drawing.Point(172, $fy)
    $tb.Size = New-Object System.Drawing.Size(214, 22)
    if ($f.secret) { $tb.UseSystemPasswordChar = $true }
    $dlg.Controls.Add($tb)

    # El valor guardado NUNCA se vuelca en un control: solo se dice si existe.
    # (TextBox.PlaceholderText no existe en el WinForms de .NET Framework, que
    # es el que trae Windows PowerShell 5.1, asi que va como etiqueta aparte.)
    $mark = New-Object System.Windows.Forms.Label
    $mark.Text = if ($current.ContainsKey($f.key) -and $current[$f.key]) { 'guardado' } else { 'vacio' }
    $mark.ForeColor = if ($current.ContainsKey($f.key) -and $current[$f.key]) {
      [System.Drawing.Color]::FromArgb(22, 140, 60) } else { [System.Drawing.Color]::FromArgb(150, 150, 150) }
    $mark.Location = New-Object System.Drawing.Point(392, ($fy + 3))
    $mark.Size = New-Object System.Drawing.Size(60, 20)
    $dlg.Controls.Add($mark)

    $boxes[$f.key] = $tb
    $fy += 30
  }

  $note = New-Object System.Windows.Forms.Label
  $note.Text = 'Al guardar se reinicia n8n para que los tome.'
  $note.Location = New-Object System.Drawing.Point(18, ($fy + 8))
  $note.Size = New-Object System.Drawing.Size(430, 20)
  $note.ForeColor = [System.Drawing.Color]::FromArgb(110, 110, 110)
  $dlg.Controls.Add($note)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Guardar'; $ok.Location = New-Object System.Drawing.Point(258, ($fy + 36))
  $ok.Size = New-Object System.Drawing.Size(90, 30); $ok.FlatStyle = 'System'
  $dlg.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancelar'; $cancel.Location = New-Object System.Drawing.Point(356, ($fy + 36))
  $cancel.Size = New-Object System.Drawing.Size(90, 30); $cancel.FlatStyle = 'System'
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $dlg.Controls.Add($cancel)
  $dlg.CancelButton = $cancel

  $ok.Add_Click({
    $changes = @{}
    foreach ($f in $fields) {
      $v = $boxes[$f.key].Text
      if ($v) { $changes[$f.key] = $v.Trim() }
    }
    if ($changes.Count -eq 0) { $dlg.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $dlg.Close(); return }
    if (Save-EnvValues $changes) {
      $dlg.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $dlg.Close()
    } else {
      [System.Windows.Forms.MessageBox]::Show(
        'No se pudo escribir la configuracion. Revisa el log en la carpeta de logs.',
        'Personal Assistant', 'OK', 'Error') | Out-Null
    }
  })

  if ($dlg.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
    Set-Banner 'Credenciales guardadas. Reiniciando n8n...' ([System.Drawing.Color]::FromArgb(190, 130, 0))
    Start-Control -Action 'restart' -Message 'Credenciales guardadas. Reiniciando los servicios...'
  }
  $dlg.Dispose()
}

# Escribe claves en el .env del directorio de datos conservando el resto del
# fichero (comentarios incluidos). Nunca registra los valores.
function Save-EnvValues([hashtable] $Values) {
  $path = Get-ApEnvPath
  try {
    $lines = if (Test-Path $path) { @(Get-Content $path) } else { @() }
    foreach ($k in $Values.Keys) {
      $done = $false
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($k))\s*=") {
          $lines[$i] = "$k=$($Values[$k])"
          $done = $true
          break
        }
      }
      if (-not $done) { $lines += "$k=$($Values[$k])" }
    }
    # UTF-8 SIN BOM: docker compose lee este fichero, y un BOM delante de la
    # primera clave la volveria ilegible.
    [IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object System.Text.UTF8Encoding $false))
    # Solo los nombres, jamas los valores.
    Write-ApLog -Component 'launcher' -Message ("credenciales actualizadas: " + (($Values.Keys | Sort-Object) -join ', '))
    return $true
  } catch {
    Write-ApLog -Level ERROR -Component 'launcher' -Message "no se pudo escribir el .env: $($_.Exception.GetType().Name)"
    return $false
  }
}

# --- Refresco --------------------------------------------------------------
function Update-Ui {
  $states = Get-StackStatus
  $running = 0
  foreach ($row in $Rows) {
    $c = $script:RowControls[$row.key]
    $s = $states[$row.key]
    $c.dot.ForeColor = $StatusColor[$s.status]
    $c.state.Text    = $StatusText[$s.status]
    $c.detail.Text   = $s.detail
    if ($s.status -in @('online','configured')) { $running++ }
  }

  $total = $Rows.Count
  if ($script:Busy) {
    # La accion en curso manda hasta que el proceso de control.ps1 termine.
    if ($script:Job -and $script:Job.HasExited) {
      $script:Busy = $false
      if ($script:Job.ExitCode -ne 0) {
        Set-Banner "La ultima accion fallo (codigo $($script:Job.ExitCode)). Mira 'Ver logs'." ([System.Drawing.Color]::FromArgb(180, 50, 40))
      } else {
        Set-Banner ''
      }
      $script:Job = $null
    }
  } elseif ($running -eq $total) {
    Set-Banner "Todo listo. El panel esta en $PanelUrl" ([System.Drawing.Color]::FromArgb(22, 140, 60))
  } elseif ($running -eq 0) {
    Set-Banner 'Los servicios estan parados. Pulsa "Iniciar servicios".'
  } else {
    Set-Banner "$running de $total servicios en marcha."
  }

  $btnStart.Enabled   = -not $script:Busy
  $btnStop.Enabled    = -not $script:Busy
  $btnRestart.Enabled = -not $script:Busy
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.Add_Tick({ Update-Ui })

# Cuando el proceso se lanza oculto (hidden.vbs, para que no parpadee la
# consola), Windows guarda SW_HIDE en su STARTUPINFO y la PRIMERA ventana que
# se muestra hereda ese estado: el formulario existe pero nace invisible. Se
# fuerza el estado de la ventana en cuanto tiene handle.
Add-Type -Namespace PaLauncher -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@

# El arranque va en un temporizador de un solo disparo, no en Form.Shown: con
# SW_HIDE heredado el evento Shown puede no llegar a dispararse, mientras que
# los temporizadores si corren en cuanto arranca el bucle de mensajes.
$boot = New-Object System.Windows.Forms.Timer
$boot.Interval = 200
$boot.Add_Tick({
  $boot.Stop()
  try {
    [PaLauncher.Native]::ShowWindow($form.Handle, 5) | Out-Null   # SW_SHOW
    [PaLauncher.Native]::SetForegroundWindow($form.Handle) | Out-Null
  } catch { }
  Update-Ui
  $timer.Start()
  if (-not $NoAutoStart) {
    # Si no hay backend, arrancar es lo que el usuario venia a hacer.
    if (-not (Test-HttpHealthy $HealthUrl 2)) {
      Start-Control -Action 'start' -Message 'Arrancando los servicios (la primera vez puede tardar)...'
    }
  }
})
$form.Add_FormClosed({ $timer.Stop(); $boot.Stop() })
$boot.Start()

Write-ApLog -Component 'launcher' -Message 'launcher abierto'
[System.Windows.Forms.Application]::Run($form)
