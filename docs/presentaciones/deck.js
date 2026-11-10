/* Reproductor de presentaciones: sin dependencias, funciona sin internet.
   Teclas:  → / Espacio / PageDown = avanzar (revela el siguiente paso antes de cambiar de diapositiva)
            ← / PageUp = retroceder · Inicio / Fin · N = notas del profesor · T = tema claro/oscuro
            F = pantalla completa · ? = ayuda. En pantallas táctiles: deslizar. Imprimir (Ctrl+P) = PDF. */
(function () {
  "use strict";
  var escenario = document.getElementById("escenario");
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var barra = document.querySelector("#barra i");
  var contador = document.getElementById("contador");
  var panelNotas = document.getElementById("notas");
  var actual = 0;

  function escalar() {
    var k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    escenario.style.transform = "scale(" + k + ")";
  }

  function pasosDe(s) { return Array.prototype.slice.call(s.querySelectorAll(".paso")); }
  function visibles(s) { return pasosDe(s).filter(function (p) { return p.classList.contains("visto"); }).length; }

  function mostrarNotas() {
    var a = slides[actual].querySelector("aside.notas");
    panelNotas.innerHTML = "<small>Notas del profesor · diapositiva " + (actual + 1) + "</small>" + (a ? a.innerHTML : "<i>Sin notas.</i>");
  }

  function ir(n, alFinal) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    slides[actual].classList.remove("activa");
    actual = n;
    var s = slides[actual];
    s.classList.add("activa");
    // al entrar hacia adelante se ocultan los pasos (salvo los marcados "inicio"); al volver atrás se muestran todos
    pasosDe(s).forEach(function (p) { p.classList.toggle("visto", !!alFinal || p.classList.contains("inicio")); });
    barra.style.width = ((actual + 1) / slides.length) * 100 + "%";
    contador.textContent = actual + 1 + " / " + slides.length;
    try { history.replaceState(null, "", "#" + (actual + 1)); } catch (e) { /* sin historial */ }
    mostrarNotas();
  }

  function avanzar() {
    var s = slides[actual];
    var pasos = pasosDe(s);
    var siguiente = pasos.filter(function (p) { return !p.classList.contains("visto"); })[0];
    if (siguiente) { siguiente.classList.add("visto"); return; }
    if (actual < slides.length - 1) ir(actual + 1, false);
  }

  function retroceder() {
    var s = slides[actual];
    var vistos = pasosDe(s).filter(function (p) { return p.classList.contains("visto"); });
    if (vistos.length) { vistos[vistos.length - 1].classList.remove("visto"); return; }
    if (actual > 0) ir(actual - 1, true);
  }

  function tema() {
    var r = document.documentElement;
    var nuevo = r.getAttribute("data-tema") === "oscuro" ? "claro" : "oscuro";
    r.setAttribute("data-tema", nuevo);
    try { localStorage.setItem("tema-presentacion", nuevo); } catch (e) { /* sin almacenamiento */ }
  }

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); avanzar(); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); retroceder(); }
    else if (k === "Home") ir(0, false);
    else if (k === "End") ir(slides.length - 1, true);
    else if (k === "n" || k === "N") panelNotas.classList.toggle("abierto");
    else if (k === "t" || k === "T") tema();
    else if (k === "f" || k === "F") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
    else if (k === "?") alert("→ avanzar · ← retroceder · N notas del profesor · T tema claro/oscuro · F pantalla completa · Inicio/Fin · Ctrl+P guarda como PDF");
  });

  var x0 = null;
  document.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) { if (dx < 0) avanzar(); else retroceder(); }
    x0 = null;
  }, { passive: true });

  // clic en el tercio derecho/izquierdo del escenario (sin interferir con enlaces ni con el panel de notas)
  document.getElementById("marco").addEventListener("click", function (e) {
    if (e.target.closest("a, button, input, select, textarea, #notas")) return;
    var f = window.getSelection && window.getSelection().toString();
    if (f) return;
    if (e.clientX > window.innerWidth * 0.66) avanzar();
    else if (e.clientX < window.innerWidth * 0.33) retroceder();
  });

  window.addEventListener("hashchange", function () {
    var n = parseInt((location.hash || "").replace("#", ""), 10);
    if (!isNaN(n) && n - 1 !== actual) ir(n - 1, false);
  });
  window.addEventListener("resize", escalar);
  try {
    var guardado = localStorage.getItem("tema-presentacion");
    if (guardado) document.documentElement.setAttribute("data-tema", guardado);
  } catch (e) { /* sin almacenamiento */ }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    Array.prototype.forEach.call(document.querySelectorAll("#escenario svg"), function (sv) { if (sv.pauseAnimations) sv.pauseAnimations(); });
  }
  escalar();
  var inicio = parseInt((location.hash || "").replace("#", ""), 10);
  slides[0].classList.add("activa");
  ir(isNaN(inicio) ? 0 : inicio - 1, false);
})();
