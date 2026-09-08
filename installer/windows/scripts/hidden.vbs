' hidden.vbs - lanza un script de PowerShell sin que parpadee una consola.
'
'   wscript.exe hidden.vbs <script.ps1> [argumentos...]
'
' powershell.exe -WindowStyle Hidden sigue creando la ventana de consola y la
' oculta despues, asi que se ve un parpadeo negro al abrir la aplicacion desde
' un acceso directo. WScript.Shell.Run con intWindowStyle = 0 la crea ya
' oculta, que es lo que queremos para el launcher y para el icono de bandeja.
'
' No contiene logica de producto: solo redirige.

Option Explicit

Dim shell, i, cmd

If WScript.Arguments.Count < 1 Then
  WScript.Quit 2
End If

Set shell = CreateObject("WScript.Shell")

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & _
      WScript.Arguments(0) & """"

For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next

' 0 = ventana oculta, False = no esperar a que termine.
shell.Run cmd, 0, False
