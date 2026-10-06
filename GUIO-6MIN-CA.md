# Guió de la presentació (6 minuts, en català)

**Treball de recerca:** Desenvolupament d'un Assistent Personal Intel·ligent
**Autor:** Àlex Moga de Santiago
**Durada:** uns 6 minuts (≈ 800 paraules a ritme tranquil)

---

## 1. Portada (0:00 – 0:15)

Bon dia. Sóc l'Àlex Moga i el meu treball tracta de com construir un **assistent personal intel·ligent**: un programa que gestiona per mi el correu, la feina i les notícies fent servir intel·ligència artificial.

## 2. Context (0:15 – 0:40)

El problema és que cada dia rebem **desenes de correus i notificacions**. Classificar-los a mà és **repetitiu**, fa perdre temps, i la informació està **dispersa en moltes plataformes**. Volia que una màquina fes aquesta feina per mi.

## 3. Pilars del sistema (0:40 – 1:10)

El sistema té tres peces. **Docker**, que és com una caixa tancada dins l'ordinador on tot funciona de forma aïllada. **n8n**, l'eina que organitza les tasques automàtiques, com un director d'orquestra. I un **LLM**, que és la intel·ligència artificial que entén el text; pot ser Nvidia NIM, Gemini o OpenRouter, i es pot canviar.

## 4. Interpretació semàntica (1:10 – 1:40)

Aquí hi ha la part clau. Si escric «Hola Àlex, recorda que tenim la reunió demà a les 10 h per videoconferència», la IA ho **converteix en dades ordenades**: què és, quan, a quina hora i en quin format. Amb això el sistema ja pot crear un esdeveniment al calendari. Entén el **significat** del text, no només les paraules.

## 5. Flux de treball (1:40 – 2:00)

Tot segueix quatre passos: **recepció**, **neteja**, **classificació** i **acció**.

## 6. Àrees d'automatització (2:00 – 2:15)

He dividit el treball en quatre àrees: **Gestió, Laboral, Notícies i Marca Personal**. De cadascuna us ensenyo com està muntada a n8n i el resultat que rebo al mòbil per Telegram.

## 7–8. Gestió (2:15 – 2:50)

Aquest és el flux a n8n: cada quadrat és un pas. I aquest és el resultat: m'ha arribat un correu de la Marta convocant una reunió, el sistema l'ha **classificat** i ha **creat l'esdeveniment** al calendari sense que jo fes res.

## 10–11. Laboral (2:50 – 3:15)

El segon flux **filtra ofertes de feina** i em quedo només amb les que m'interessen. Cada dia rebo un missatge amb les ofertes **resumides i amb l'enllaç**.

## 13–14. Notícies (3:15 – 3:40)

El tercer flux recull notícies del sector, les **sintetitza** amb la IA i m'envia un **resum diari** amb enllaços per llegir l'article complet.

## 16–17. Marca Personal (3:40 – 4:05)

El quart flux m'ajuda amb LinkedIn: extreu idees de les notícies i m'envia **esborranys de publicacions**. Jo els reviso i decideixo si en publico algun.

## 18–20. Panell de control (4:05 – 4:50)

A més de Telegram he fet un **panell web**. El *dashboard* mostra l'**estat del sistema**: automatitzacions actives, si la IA està connectada i si els serveis funcionen. Hi ha un **assistent d'IA** on puc preguntar en llenguatge natural què ha passat avui, i una pàgina d'**activitat** amb l'historial d'execucions per detectar errors.

## 21–22. Configuració (4:50 – 5:15)

Perquè ho pugui fer servir qualsevol persona, hi ha un **assistent d'instal·lació pas a pas**. I des del panell es pot **triar quina IA i quin model** utilitzar, sense tocar el codi.

## 23. Rendiment (5:15 – 5:35)

Per comprovar si funciona bé, el vaig **avaluar amb 75 proves reals**: la classificació va ser correcta en un **89,3 %** dels casos. És un bon resultat, però no perfecte.

## 24. Conclusions (5:35 – 6:00)

Tres conclusions. **Eficiència:** es redueix molt el temps de gestió manual. **Accessibilitat:** s'ha fet amb eines obertes i gratuïtes. **Supervisió:** les accions crítiques les ha de validar una persona, el que s'anomena *Human-in-the-Loop*. La IA ajuda, però no decideix sola el que és important.

## 25. Tancament

Moltes gràcies per la vostra atenció. Hi ha alguna pregunta?

---

*Les diapositives 9, 12 i 15 (repetició d'«Àrees d'automatització») no necessiten text propi: serveixen de pas entre àrees. Si vas just de temps, retalla les frases de la secció 3 i del panell de control.*
