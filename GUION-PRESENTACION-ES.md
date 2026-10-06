# Guion de la presentación (en castellano)

**Trabajo de investigación:** Desarrollo de un Asistente Personal Inteligente
**Autor:** Álex Moga de Santiago
**Duración aproximada:** 8-10 minutos (unos 20-30 segundos por diapositiva)

> Los términos técnicos (n8n, Docker, LLM, JSON, Telegram) se explican con palabras sencillas la primera vez que aparecen, para que se entienda sin conocimientos de informática.

---

## 1. Portada

Buenos días. Me llamo Álex Moga y mi trabajo de investigación trata sobre cómo construir un **asistente personal inteligente**: un programa que me ayuda a gestionar el correo, el trabajo, las noticias y mis redes profesionales, usando inteligencia artificial para que lo haga de forma automática.

## 2. Contexto: sobrecarga de información diaria

Todo empezó con un problema que tenemos casi todos. Recibimos **decenas de correos y notificaciones cada día**. Clasificarlos a mano es **repetitivo y nos hace perder tiempo**, y además la información está **dispersa en muchas plataformas** distintas. Quería que una máquina hiciera ese trabajo aburrido por mí.

## 3. Pilares del sistema

Para resolverlo, el sistema se apoya en tres piezas:

- **Docker:** es como una caja cerrada en mi ordenador donde funciona todo, separada del resto, para que sea ordenado y seguro.
- **n8n:** es la herramienta que organiza las tareas automáticas, como un director de orquesta que decide qué pasa primero y qué después.
- **LLM (modelo de lenguaje):** es la inteligencia artificial, parecida a ChatGPT, que entiende el texto y toma decisiones. Puede ser Nvidia NIM, Gemini u OpenRouter, y se puede cambiar según se necesite.

## 4. Interpretación semántica con Gemini

Aquí está la parte más interesante. Los ordenadores normalmente no entienden frases normales; yo les escribo "Hola Álex, recuerda que tenemos la reunión mañana a las 10h por videoconferencia" y la IA lo **convierte en datos ordenados**: qué es (una reunión), cuándo (mañana), a qué hora (10:00) y en qué formato (videoconferencia). Con esos datos el sistema ya puede crear un evento en el calendario. Eso es **interpretar el significado** del texto, no solo leer palabras.

## 5. Flujo de trabajo automatizado

Todo el proceso sigue cuatro pasos:

1. **Recepción:** llega la información (por ejemplo, un correo).
2. **Limpieza:** se quita lo que sobra y se deja lo importante.
3. **Clasificación:** la IA decide de qué tipo es.
4. **Acción:** el sistema hace lo que corresponde (crear un evento, enviar un resumen…).

## 6. Áreas de automatización

Clasifiqué el trabajo en **cuatro áreas**: Gestión, Laboral, Noticias y Marca Personal. Ahora las veré una a una; de cada una enseño primero cómo está montada por dentro y luego el resultado que me llega al móvil.

*(Las diapositivas 9, 12 y 15 repiten este mismo esquema para indicar que pasamos a la siguiente área.)*

## 7. Gestión: workflow en n8n

Esta es la pantalla de n8n. Cada cuadradito es un paso y las líneas los unen, como un diagrama de flujo. Aquí se lee un correo y se decide qué hacer con él.

## 8. Gestión: resultado en Telegram

Y este es el resultado. Me llegó un correo de Marta convocando una reunión; el sistema lo **clasificó** como trabajo con prioridad media, y **creó automáticamente el evento** en mi calendario. Telegram es la aplicación de mensajería donde recibo el aviso, y no he tenido que hacer nada.

## 9. Transición al área Laboral

*(Mismo esquema de las áreas; paso a la segunda.)*

## 10. Laboral: workflow en n8n

El segundo flujo busca **ofertas de trabajo** y las filtra para quedarse solo con las que me interesan.

## 11. Laboral: resultado en Telegram

Cada día recibo un mensaje con las **ofertas resumidas** y con el **enlace** para verlas. Por ejemplo, puestos de ingeniería industrial en Cataluña, ya ordenados y con una explicación corta.

## 12. Transición al área Noticias

*(Paso a la tercera.)*

## 13. Noticias: workflow en n8n

El tercer flujo recoge noticias del sector, las lee y las **sintetiza** con la IA.

## 14. Noticias: resultado en Telegram

El resultado es un **resumen diario de noticias** del sector aeroespacial e industrial, con un enlace en cada una por si quiero leer el artículo completo. Me ahorra leer decenas de páginas.

## 15. Transición al área Marca Personal

*(Paso a la cuarta.)*

## 16. Marca Personal: workflow en n8n

El cuarto flujo me ayuda con mi **imagen profesional** en LinkedIn. Extrae ideas de las noticias para posibles publicaciones.

## 17. Marca Personal: resultado en Telegram

Me envía **borradores** de publicaciones para LinkedIn. Yo los reviso y decido si publico alguno; el sistema propone y yo decido.

## 18. Panel de control: Dashboard

Además de Telegram, construí un **panel web** para ver todo en un solo sitio. Aquí aparece el **estado del sistema**: cuántas automatizaciones hay activas, si la IA está conectada, si los servicios funcionan y cuántas ejecuciones llevan.

## 19. Asistente de IA

Dentro del panel hay un chat donde puedo preguntar **en lenguaje normal**, por ejemplo "¿qué ha pasado hoy?", y la IA me contesta con un resumen de la actividad.

## 20. Actividad

Aquí se guarda el **historial**: qué automatización se ejecutó, a qué hora y si salió bien. Sirve para comprobar que todo funciona y detectar errores.

## 21. Configuración inicial (Setup)

Para que lo pueda usar cualquiera, hice un **asistente de instalación paso a paso**. La idea es que el usuario no tenga que tocar archivos técnicos: el programa le guía y hace él mismo las comprobaciones.

## 22. Configuración del proveedor de IA

Desde el panel se puede **elegir qué inteligencia artificial usar** y con qué modelo, sin cambiar el código. Si un proveedor falla o deja de ser gratuito, se cambia por otro en un momento.

## 23. Rendimiento del modelo: 89,3 %

Para saber si funciona bien lo **evalué**. Le di **75 pruebas reales** y la clasificación fue correcta en el **89,3 %** de los casos. Es un resultado muy bueno, aunque no perfecto, y por eso conviene que una persona revise lo importante.

## 24. Conclusiones

Saco tres conclusiones:

- **Eficiencia:** se reduce drásticamente el tiempo de gestión manual diaria.
- **Accesibilidad:** el sistema se monta con herramientas gratuitas y de código abierto, al alcance de cualquiera.
- **Supervisión:** para acciones críticas necesita que una persona valide lo que propone la máquina (lo que se llama *Human-in-the-Loop*, "humano en el circuito"). La IA ayuda, pero no decide sola lo importante.

## 25. Cierre

Muchas gracias por vuestra atención. ¿Hay alguna pregunta?

---

## Posibles preguntas de la profesora (con respuesta corta)

- **¿Qué es la inteligencia artificial aquí?** Un programa que entiende texto escrito como una persona y lo convierte en información que el ordenador puede usar.
- **¿Es seguro?** Todo funciona en mi propio ordenador, dentro de Docker, y las contraseñas no se guardan en el código.
- **¿Por qué no es 100 % exacto?** Porque la IA a veces se equivoca (89,3 % de acierto); por eso las acciones importantes las confirma una persona.
- **¿Cualquiera puede usarlo?** Sí, esa es la idea del asistente de configuración y del uso de herramientas abiertas y gratuitas.
