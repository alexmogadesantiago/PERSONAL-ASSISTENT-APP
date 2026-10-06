from pathlib import Path

html = r'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ilerpotent — Automatización inteligente</title>
<meta name="description" content="Automatización inteligente de facturas y procesos administrativos para empresas.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#161C13;--dark:#2C3826;--olive:#4E6142;--light:#7C8C6E;--gold:#BE8A24;--gold2:#E4B65B;--paper:#FBFAF6;--cream:#EDEAE0;--line:#d9d5c9;--red:#9A452C}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Instrument Sans",sans-serif;line-height:1.5}h1,h2,h3{font-family:"Bricolage Grotesque",sans-serif;line-height:1.02;margin:0}button,a{font:inherit}a{text-decoration:none;color:inherit}.progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--gold);z-index:50}.nav{position:fixed;top:0;left:0;right:0;z-index:40;padding:18px 5%;display:flex;justify-content:space-between;align-items:center;mix-blend-mode:multiply}.logo{font-family:"Bricolage Grotesque";font-weight:700;font-size:22px;letter-spacing:-.04em}.logo i{display:inline-block;width:11px;height:11px;background:var(--gold);transform:rotate(45deg);margin-right:9px}.navlinks{display:flex;gap:26px;font-size:13px}.navlinks a:hover{color:var(--gold)}
.container{width:min(1180px,90%);margin:auto}.hero{min-height:100vh;display:grid;grid-template-columns:1.05fr .95fr;gap:7%;align-items:center;padding:120px 0 70px}.eyebrow,.label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--olive);font-weight:600}.hero h1{font-size:clamp(55px,7vw,100px);letter-spacing:-.055em;margin:20px 0}.hero h1 span{color:var(--gold)}.hero p{font-size:19px;max-width:580px;color:#4c5147}.actions{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}.btn{border:1px solid var(--ink);padding:13px 20px;border-radius:4px;display:inline-flex;align-items:center;gap:10px;transition:.25s}.btn.primary{background:var(--ink);color:white}.btn:hover{transform:translateY(-2px)}.invoice-wrap{position:relative;min-height:530px;display:grid;place-items:center}.invoice{width:min(390px,90%);background:white;border:1px solid var(--line);box-shadow:18px 22px 50px #161c1320;padding:30px;transform:rotate(2deg);animation:float 5s ease-in-out infinite}.invoice-head{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:18px}.inv-title{font-family:"Bricolage Grotesque";font-size:24px}.fake-lines{margin:25px 0}.fake-lines div{height:8px;background:var(--cream);margin:10px 0}.fake-lines div:nth-child(2){width:70%}.fake-lines div:nth-child(3){width:85%}.fake-lines div:nth-child(4){width:55%}.inv-total{font-size:28px;font-family:"Bricolage Grotesque";margin-top:24px}.status{margin-top:22px;padding:12px;background:#edf0e8;color:var(--olive);font-size:12px;font-weight:600;letter-spacing:.08em}.orbit{position:absolute;border:1px solid var(--gold2);width:460px;height:460px;border-radius:50%;animation:spin 18s linear infinite}.orbit:after{content:"";position:absolute;width:12px;height:12px;background:var(--gold);top:20px;right:80px;transform:rotate(45deg)}
@keyframes float{50%{transform:rotate(-1deg) translateY(-12px)}}@keyframes spin{to{transform:rotate(360deg)}}
section{padding:120px 0}.section-head{max-width:720px;margin-bottom:60px}.section-head h2{font-size:clamp(42px,6vw,76px);letter-spacing:-.05em;margin:14px 0}.section-head p{font-size:18px;color:#62675d}
.story{background:var(--ink);color:white}.story .section-head p{color:#bfc5b8}.story-stage{height:72vh;min-height:560px;position:relative;display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:8%}.story-card{position:sticky;top:18vh}.stage-num{font-size:12px;letter-spacing:.2em;color:var(--gold2)}.story h3{font-size:clamp(45px,6vw,82px);margin:12px 0}.story-desc{color:#c6cbbb;max-width:480px}.stage-data{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}.pill{border:1px solid #ffffff25;padding:9px 12px;border-radius:100px;font-size:12px}.stage-visual{height:400px;border:1px solid #ffffff20;position:relative;padding:30px;display:flex;align-items:center;justify-content:center;background:#ffffff05;overflow:hidden}.stage-visual .doc{width:230px;background:#fff;color:var(--ink);padding:25px;box-shadow:0 20px 50px #0005;transition:.5s}.stage-visual .doc .bar{height:7px;background:var(--cream);margin:9px 0}.stage-visual .doc .bar:nth-child(3){width:65%}.stage-visual .doc .bar:nth-child(4){width:82%}.stage-visual .doc .bar:nth-child(5){width:48%}.stage-visual .scan{position:absolute;width:90%;height:2px;background:var(--gold2);animation:scan 2.4s ease-in-out infinite}.checks{font-size:16px;line-height:2.3}.checks b{color:#b9d19d}.decision{display:flex;gap:12px;width:100%}.decision div{flex:1;padding:25px;border:1px solid #ffffff20}.approved{border-color:#8aa46c!important}.review{border-color:var(--gold2)!important}.bigscore{font-size:58px;font-family:"Bricolage Grotesque";color:var(--gold2)}@keyframes scan{0%,100%{transform:translateY(-150px);opacity:0}30%,70%{opacity:1}50%{transform:translateY(150px)}}
.demo-grid{display:grid;grid-template-columns:1fr 1fr;gap:25px}.panel{border:1px solid var(--line);background:white;padding:28px}.invoice-demo{min-height:500px}.fields{display:grid;gap:12px}.field{border-bottom:1px solid var(--line);padding:12px 0;display:flex;justify-content:space-between;gap:15px}.confidence{font-size:11px;color:var(--olive);white-space:nowrap}.demo-result{margin-top:25px;padding:18px;background:#eef1e9;border-left:3px solid var(--olive)}.demo-error{margin-top:12px;padding:18px;background:#f3e9e4;border-left:3px solid var(--red);display:none}.demo-buttons{display:flex;gap:8px;margin-top:20px}.smallbtn{border:1px solid var(--line);background:var(--paper);padding:9px 13px;cursor:pointer}.smallbtn.active{background:var(--ink);color:white}
.calc{background:var(--cream)}.calcbox{display:grid;grid-template-columns:1fr 1fr;gap:50px}.control{margin:25px 0}.control-top{display:flex;justify-content:space-between;font-size:14px}.value{font-family:"Bricolage Grotesque";font-size:22px}input[type=range]{width:100%;accent-color:var(--gold);margin-top:12px}.numbers{display:grid;grid-template-columns:1fr 1fr;gap:12px}.number{background:white;padding:22px;border:1px solid var(--line)}.number strong{display:block;font-family:"Bricolage Grotesque";font-size:34px}.number small{color:#686d63}
.services{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.service{border:1px solid var(--line);padding:30px;min-height:430px;display:flex;flex-direction:column;background:white;transition:.25s}.service:hover{transform:translateY(-5px);box-shadow:0 20px 40px #161c1312}.service.featured{border:2px solid var(--gold);transform:translateY(-8px)}.badge{display:inline-block;color:var(--gold);font-size:10px;letter-spacing:.15em;margin-bottom:25px}.price{font-family:"Bricolage Grotesque";font-size:42px;margin:18px 0}.service ul{padding:0;list-style:none;color:#555b50;font-size:14px}.service li{padding:7px 0;border-bottom:1px solid var(--line)}.service .btn{margin-top:auto;justify-content:center}
.diagnosis{background:var(--dark);color:white}.diag{display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:center}.diagnosis p{color:#c7cdc0}.diag-price{font-family:"Bricolage Grotesque";font-size:64px;color:var(--gold2)}.diag ul{padding-left:18px;color:#d0d5ca}.diag .btn{border-color:white}.diag .btn.primary{background:var(--gold);border-color:var(--gold);color:var(--ink)}
.control-section{background:#f0eee7}.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:0}.flow-step{padding:25px;border-top:1px solid var(--ink);position:relative}.flow-step:not(:last-child):after{content:"→";position:absolute;right:15px;top:22px;color:var(--gold);font-size:22px}.flow-step strong{display:block;font-family:"Bricolage Grotesque";font-size:20px;margin:10px 0}.faq{display:grid;grid-template-columns:.8fr 1.2fr;gap:80px}.faq details{border-top:1px solid var(--line);padding:18px 0}.faq summary{cursor:pointer;font-weight:600}.final{background:var(--ink);color:white;text-align:center;padding:150px 0}.final h2{font-size:clamp(48px,7vw,95px);letter-spacing:-.055em;max-width:950px;margin:auto}.final p{color:#c5cabf;font-size:18px}.footer{background:var(--ink);color:white;border-top:1px solid #ffffff20;padding:30px 5%;display:flex;justify-content:space-between;font-size:12px;color:#adb3a6}
.reveal{opacity:0;transform:translateY(30px);transition:opacity .8s,transform .8s}.reveal.visible{opacity:1;transform:none}
@media(max-width:800px){.navlinks{display:none}.hero,.demo-grid,.calcbox,.diag,.faq{grid-template-columns:1fr}.hero{padding-top:110px}.invoice-wrap{min-height:420px}.orbit{width:340px;height:340px}.story-stage{grid-template-columns:1fr;height:auto;min-height:620px;padding:70px 0}.story-card{position:relative;top:auto}.stage-visual{height:300px}.services{grid-template-columns:1fr}.service.featured{transform:none}.flow{grid-template-columns:1fr 1fr}.flow-step:not(:last-child):after{display:none}.numbers{grid-template-columns:1fr 1fr}section{padding:85px 0}.footer{flex-direction:column;gap:12px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<nav class="nav"><a class="logo" href="#"><i></i>ilerpotent</a><div class="navlinks"><a href="#proceso">Proceso</a><a href="#demo">Demo</a><a href="#calculadora">Calculadora</a><a href="#servicios">Servicios</a><a href="#contacto">Contacto</a></div></nav>

<main>
<section class="hero container">
<div class="reveal">
<div class="eyebrow">Automatización de procesos · Lleida / Ponent</div>
<h1>Automatiza tus facturas.<br><span>Antes, comprueba si te hace falta.</span></h1>
<p>Analizamos cómo trabajas, eliminamos lo innecesario y automatizamos lo que realmente merece la pena.</p>
<div class="actions"><a class="btn primary" href="#contacto">Analizar mi proceso →</a><a class="btn" href="#proceso">Ver cómo funciona ↓</a></div>
</div>
<div class="invoice-wrap reveal"><div class="orbit"></div><div class="invoice">
<div class="invoice-head"><div><div class="inv-title">FACTURA</div><small>F-2026-0142</small></div><small>04/09/2026</small></div>
<div class="fake-lines"><div></div><div></div><div></div><div></div></div>
<small>BASE IMPONIBLE</small><div class="inv-total">1.250,00 €</div><div class="status">✓ AUTO APPROVED · 99%</div>
</div></div>
</section>

<section class="story" id="proceso"><div class="container">
<div class="section-head reveal"><div class="label">El proceso</div><h2>Así funciona Ilerpotent.</h2><p>De una factura a un proceso terminado.</p></div>

<div class="story-stage reveal"><div class="story-card"><div class="stage-num">01 / ENTRADA</div><h3>Entrada</h3><p class="story-desc">La documentación llega desde los canales que ya utiliza tu empresa.</p><div class="stage-data"><span class="pill">PDF</span><span class="pill">EMAIL</span><span class="pill">CARPETA</span></div></div><div class="stage-visual"><div class="doc"><b>FACTURA</b><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div></div>

<div class="story-stage reveal"><div class="story-card"><div class="stage-num">02 / LECTURA</div><h3>Lectura</h3><p class="story-desc">OCR + IA extraen los datos relevantes de cada documento.</p><div class="stage-data"><span class="pill">PROVEEDOR</span><span class="pill">NIF</span><span class="pill">FECHA</span><span class="pill">IVA</span><span class="pill">TOTAL</span></div></div><div class="stage-visual"><div class="doc"><b>DATOS EXTRAÍDOS</b><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div><div class="scan"></div></div></div>

<div class="story-stage reveal"><div class="story-card"><div class="stage-num">03 / VALIDACIÓN</div><h3>Validación</h3><p class="story-desc"><b>La IA extrae. Las reglas comprueban.</b> Totales, impuestos, proveedor y duplicados.</p></div><div class="stage-visual"><div class="checks">TOTAL <b>✓</b><br>IVA <b>✓</b><br>PROVEEDOR <b>✓</b><br>NIF <b>✓</b><br>DUPLICADO <b>✓</b></div></div></div>

<div class="story-stage reveal"><div class="story-card"><div class="stage-num">04 / DECISIÓN</div><h3>Decisión</h3><p class="story-desc">Los documentos claros siguen automáticamente. Las excepciones llegan a una persona.</p><div class="bigscore">98%</div></div><div class="stage-visual"><div class="decision"><div class="approved"><small>AUTO</small><br><b>APPROVED</b></div><div class="review"><small>HUMAN</small><br><b>REVIEW</b></div></div></div></div>

<div class="story-stage reveal"><div class="story-card"><div class="stage-num">05 / EXPORTACIÓN</div><h3>Exportación</h3><p class="story-desc">El resultado queda listo para el sistema que ya utiliza tu empresa.</p><div class="stage-data"><span class="pill">ERP</span><span class="pill">CSV</span><span class="pill">ARCHIVO</span></div></div><div class="stage-visual"><div class="doc"><b>PROCESO COMPLETADO</b><div class="bar"></div><div class="bar"></div><div class="status">✓ EXPORTED</div></div></div></div>
</div></section>

<section id="demo"><div class="container"><div class="section-head reveal"><div class="label">Demo</div><h2>Pruébalo.</h2><p>Una factura ficticia. El mismo proceso que automatizamos en una empresa real.</p></div>
<div class="demo-grid reveal"><div class="panel invoice-demo"><div class="label">DOCUMENTO</div><h3 style="font-size:32px;margin:15px 0">ACME S.L.</h3><p>B12345678 · F-2026-0142</p><div style="height:180px;border:1px dashed var(--line);display:grid;place-items:center;margin:25px 0;color:#777">Vista previa de factura</div><strong>Total: 1.512,50 €</strong></div>
<div class="panel"><div class="label">EXTRACCIÓN + VALIDACIÓN</div><div class="fields">
<div class="field"><span>Proveedor<br><b>ACME S.L.</b></span><span class="confidence">99%</span></div>
<div class="field"><span>NIF<br><b>B12345678</b></span><span class="confidence">98%</span></div>
<div class="field"><span>Nº factura<br><b>F-2026-0142</b></span><span class="confidence">97%</span></div>
<div class="field"><span>Fecha<br><b>04/09/2026</b></span><span class="confidence">99%</span></div>
<div class="field"><span>Total<br><b>1.512,50 €</b></span><span class="confidence">99%</span></div></div>
<div class="demo-result" id="result"><b>✓ VALIDATION PASSED</b><br>AUTO APPROVED</div>
<div class="demo-error" id="error"><b>! IVA / TOTAL INCONSISTENT</b><br>REVIEW REQUIRED</div>
<div class="demo-buttons"><button class="smallbtn active" id="okBtn">Caso correcto</button><button class="smallbtn" id="errBtn">Ver excepción</button></div></div></div>
</div></section>

<section class="calc" id="calculadora"><div class="container"><div class="section-head reveal"><div class="label">Calculadora</div><h2>¿Cuánto tiempo estás perdiendo?</h2><p>Calcula de forma orientativa el esfuerzo administrativo de gestionar facturas.</p></div>
<div class="calcbox reveal"><div><div class="control"><div class="control-top"><span>Facturas al mes</span><span class="value" id="docsVal">2000</span></div><input id="docs" type="range" min="100" max="10000" value="2000" step="100"></div>
<div class="control"><div class="control-top"><span>Minutos por factura</span><span class="value" id="minsVal">4</span></div><input id="mins" type="range" min="1" max="20" value="4"></div>
<div class="control"><div class="control-top"><span>Coste por hora</span><span class="value" id="costVal">20 €</span></div><input id="cost" type="range" min="10" max="60" value="20"></div></div>
<div class="numbers"><div class="number"><small>Horas / mes</small><strong id="hours">133 h</strong></div><div class="number"><small>Horas / año</small><strong id="year">1.600 h</strong></div><div class="number"><small>Coste estimado / mes</small><strong id="money">2.667 €</strong></div><div class="number"><small>Documentos / año</small><strong id="docsYear">24.000</strong></div></div></div></div></section>

<section id="servicios"><div class="container"><div class="section-head reveal"><div class="label">Servicios</div><h2>Tres formas de trabajar con Ilerpotent.</h2></div><div class="services reveal">
<div class="service"><span class="badge">01 · BASE</span><h3>Base</h3><div class="price">75 €<small>/mes</small></div><small>+ 250 € instalación</small><ul><li>Hasta 1.500 documentos/mes</li><li>1 sistema</li><li>Lectura automática</li><li>Validación</li><li>Exportación</li><li>Archivo documental</li></ul><a class="btn" href="#contacto">Empezar</a></div>
<div class="service featured"><span class="badge">02 · RECOMENDADO</span><h3>Operación</h3><div class="price">290 €<small>/mes</small></div><small>+ 690 € instalación</small><ul><li>Hasta 5.000 documentos/mes</li><li>Hasta 3 sistemas</li><li>Facturas y tickets</li><li>Automatizaciones adicionales</li><li>Dashboard</li><li>Auditoría</li></ul><a class="btn primary" href="#contacto">Hablar con Ilerpotent</a></div>
<div class="service"><span class="badge">03 · SALA DE MÁQUINAS</span><h3>Sala de máquinas</h3><div class="price">890 €<small>/mes</small></div><small>+ 1.900 € instalación</small><ul><li>Documentos sin límite</li><li>Catálogo completo</li><li>Servidor propio</li><li>Dashboard avanzado</li><li>Auditoría</li><li>Integraciones personalizadas</li><li>On-premise</li></ul><a class="btn" href="#contacto">Solicitar diagnóstico</a></div>
</div></div></section>

<section class="diagnosis"><div class="container diag reveal"><div><div class="label" style="color:var(--gold2)">Diagnóstico</div><h2 style="font-size:clamp(45px,6vw,75px);margin:15px 0">¿Y si no necesitas automatizar nada?</h2><p>También puede ser el resultado correcto.</p><div class="diag-price">490 €</div><p>Analizamos un proceso real, detectamos tareas innecesarias, oportunidades de automatización y estimamos el impacto.</p><a class="btn primary" href="#contacto">Analizar mi proceso →</a></div><div><ul><li>Análisis de un proceso real</li><li>Detección de tareas innecesarias</li><li>Oportunidades de automatización</li><li>Estimación de impacto</li><li>Propuesta técnica</li></ul><p>Si continuamos con la instalación, los 490 € se descuentan.</p></div></div></section>

<section class="control-section"><div class="container"><div class="section-head reveal"><div class="label">Control humano</div><h2>La IA decide menos de lo que parece.</h2></div><div class="flow reveal"><div class="flow-step"><span>01</span><strong>IA EXTRAE</strong><small>Lee y estructura los datos.</small></div><div class="flow-step"><span>02</span><strong>REGLAS VALIDAN</strong><small>Comprueban lo que se puede comprobar.</small></div><div class="flow-step"><span>03</span><strong>SISTEMA DECIDE</strong><small>Automatiza los casos claros.</small></div><div class="flow-step"><span>04</span><strong>PERSONA REVISA</strong><small>Las excepciones nunca se esconden.</small></div></div></div></section>

<section><div class="container"><div class="section-head reveal"><div class="label">Implementación</div><h2>De la primera conversación a producción.</h2></div><div class="flow reveal"><div class="flow-step"><span>01</span><strong>30 MIN</strong><small>Primera conversación</small></div><div class="flow-step"><span>02</span><strong>DIAGNÓSTICO</strong><small>Analizamos un proceso real</small></div><div class="flow-step"><span>03</span><strong>2 SEMANAS</strong><small>Piloto con datos reales</small></div><div class="flow-step"><span>04</span><strong>INSTALACIÓN</strong><small>Entrega y puesta en marcha</small></div></div></div></section>

<section><div class="container faq"><div class="section-head reveal"><div class="label">Preguntas</div><h2>Preguntas frecuentes.</h2></div><div class="reveal"><details open><summary>¿Ilerpotent es solo para gestorías?</summary><p>No. Está pensado para cualquier empresa que reciba y procese facturas.</p></details><details><summary>¿Qué ocurre si la IA se equivoca?</summary><p>La extracción se combina con reglas de validación, confianza y revisión humana de excepciones.</p></details><details><summary>¿Puedo usar mi ERP actual?</summary><p>El sistema está diseñado para exportar e integrarse progresivamente con los sistemas que ya utiliza cada empresa.</p></details><details><summary>¿Puedo instalarlo en mi propio servidor?</summary><p>Sí, la opción Sala de Máquinas contempla infraestructura propia y despliegues on-premise.</p></details><details><summary>¿Hay permanencia?</summary><p>No. La propuesta se basa en demostrar primero que la automatización aporta valor.</p></details></div></div></section>

<section class="final" id="contacto"><div class="container reveal"><div class="label" style="color:var(--gold2)">Ilerpotent</div><h2>Primero medimos. Después automatizamos.</h2><p>Si el proceso no merece automatizarse, te lo diremos.</p><div class="actions" style="justify-content:center"><a class="btn primary" href="mailto:hola@ilerpotent.com">Solicitar diagnóstico →</a></div></div></section>
</main>
<footer class="footer"><span>© 2026 Ilerpotent</span><span>Automatización inteligente de procesos administrativos · Lleida · Ponent</span><span>Alejandro Moga de Santiago · Fundador</span></footer>

<script>
const progress=document.getElementById('progress');
addEventListener('scroll',()=>{const h=document.documentElement;progress.style.width=(scrollY/(h.scrollHeight-innerHeight)*100)+'%'});
const observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(e=>observer.observe(e));

const docs=document.getElementById('docs'),mins=document.getElementById('mins'),cost=document.getElementById('cost');
function calc(){const d=+docs.value,m=+mins.value,c=+cost.value;const hours=d*m/60;document.getElementById('docsVal').textContent=d.toLocaleString('es-ES');document.getElementById('minsVal').textContent=m;document.getElementById('costVal').textContent=c+' €';document.getElementById('hours').textContent=Math.round(hours).toLocaleString('es-ES')+' h';document.getElementById('year').textContent=Math.round(hours*12).toLocaleString('es-ES')+' h';document.getElementById('money').textContent=Math.round(hours*c).toLocaleString('es-ES')+' €';document.getElementById('docsYear').textContent=(d*12).toLocaleString('es-ES')}
[docs,mins,cost].forEach(x=>x.addEventListener('input',calc));calc();

const ok=document.getElementById('okBtn'),err=document.getElementById('errBtn'),result=document.getElementById('result'),error=document.getElementById('error');
ok.onclick=()=>{result.style.display='block';error.style.display='none';ok.classList.add('active');err.classList.remove('active')};
err.onclick=()=>{result.style.display='none';error.style.display='block';err.classList.add('active');ok.classList.remove('active')};
</script>
</body>
</html>'''

path = Path("/mnt/data/ilerpotent-landing.html")
path.write_text(html, encoding="utf-8")
print(path)
