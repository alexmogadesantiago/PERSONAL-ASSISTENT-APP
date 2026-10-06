# Seguridad y privacidad

Personal Assistant se ejecuta en tu PC. Este documento resume qué protege y qué
no, de forma que se pueda **comprobar**, no solo creer. La vista viva está en
**Ajustes → Security** y **Ajustes → Privacy**.

## Credenciales

- Tokens OAuth, claves de API y tokens de bot se cifran con **Fernet** antes de
  entrar en PostgreSQL; la clave maestra queda fuera de la base de datos.
- El navegador **nunca** recibe un secreto: solo los últimos 4 caracteres.
  Un test recorre las respuestas de la API y los logs buscando tokens reales.
- OAuth 2.0 con **PKCE**, `state` sellado, caducado y de un solo uso; los tokens
  de actualización se renuevan solos y, si el proveedor los revoca, la conexión
  pasa a `expired` y se te pide volver a iniciar sesión.
- Permisos de **mínimo privilegio**: Drive solo ve lo que crea el asistente;
  Gmail pide leer + enviar; `gmail.modify` (archivar) es **opcional y separado**.
- Los logs no contienen tokens, contraseñas ni códigos OAuth. Los workflows de
  n8n no llevan secretos (un test lo exige) y el texto del usuario no viaja
  dentro de n8n.

## Persona en el bucle

La IA **propone**; tú confirmas; el sistema ejecuta.

| Acción | Cómo se confirma |
|---|---|
| Enviar un correo | Diálogo «Send this reply to…» en la web · botones `[Enviar] [Editar] [Cancelar]` en Telegram (caducan a los 15 min, un solo uso) |
| Archivar / marcar importante | Es una acción explícita; requiere el permiso opcional |
| Desconectar un servicio | Diálogo con lo que dejará de funcionar |
| Cambiar credenciales | Solo desde Integraciones, con tu sesión |
| Borrar correos | **No existe**: el asistente no ofrece borrar |

## Qué se envía a la IA

Solo lo necesario para cada función (remitente, asunto, fecha y texto del correo
que abres y analizas; títulos de eventos y fechas para el briefing). **Nunca**:
contraseñas, tokens, claves, el contenido de adjuntos, ni correos que no abres
ni consultas. La lista exacta, con el proveedor configurado, está en
**Ajustes → Privacy**.

## Qué permanece local

Credenciales (cifradas), tareas, memoria y preferencias, la caché de prioridad
(nivel y fecha de cada correo, **nunca el texto**), las definiciones y el
historial de automatizaciones, y el historial del chat (solo en tu navegador).
Sin telemetría ni analítica. La memoria del asistente **rechaza** cualquier texto
que parezca una contraseña, un token o un número de tarjeta.

## Telegram

El bot solo atiende al chat vinculado; los mensajes y los botones de cualquier
otro chat se ignoran. El token se guarda cifrado en el Hub.

## Superficie de la API

- Autenticación JWT de corta duración con rotación del token de refresco; límite
  de peticiones en login y registro.
- Los identificadores de correo se validan antes de llegar a una URL de Gmail.
- El relé `POST /api/automations/notify` (para que los asistentes de n8n envíen
  por el Telegram del Hub) exige el token de servicio de la instalación.
- Cada usuario solo ve sus conexiones, tareas, memoria y automatizaciones.

## Modo demo

Datos de ejemplo claramente etiquetados («Demo mode» en todas las pantallas).
No envía nada, no cambia nada en Google, no llama a ninguna IA y no usa
credenciales reales.

## Riesgos conocidos (honestidad)

- **Tokens de los 4 asistentes de serie**: están en texto claro en el `.env` del
  launcher (`%LOCALAPPDATA%`) y en el entorno del contenedor de n8n (visibles con
  `docker inspect`). Aceptable en un PC de un solo usuario; es la deuda que
  documenta [V3-AUDIT.md](V3-AUDIT.md#los-4-asistentes-de-serie-y-telegram).
- El estado de la IA y de n8n que ve el panel depende de que respondan; un
  proveedor caído se muestra como tal, nunca como «sano».
- Todo lo anterior está verificado con **servicios simulados**, salvo lo que
  indica [TESTING.md](TESTING.md#qué-se-ha-probado-con-servicios-reales).
