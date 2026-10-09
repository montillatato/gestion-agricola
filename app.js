'use strict';
/* Gestión agrícola — app del celular: chat de carga, cola sin señal y navegación. */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const num = (n, d = 1) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: d });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fechaCorta = iso => iso ? String(iso).split('-').reverse().join('/') : '';
const hoyIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// ───────────────────────── Estado persistente ─────────────────────────

const S = (() => { try { return JSON.parse(localStorage.getItem('ga') || '{}'); } catch (e) { return {}; } })();
S.chat = S.chat || []; S.hilo = S.hilo || []; S.cola = S.cola || []; S.grupos = S.grupos || {};

function persistir() {
  // Se descartan las imágenes de grupos que ya no tienen tarjetas pendientes, para no llenar el almacenamiento.
  Object.keys(S.grupos).forEach(g => {
    const pendiente = S.chat.some(i => i.grupoId === g && (i.estado === 'editando' || i.estado === 'en_cola'));
    if (!pendiente) delete S.grupos[g];
  });
  if (S.chat.length > 80) S.chat = S.chat.slice(-80);
  try {
    localStorage.setItem('ga', JSON.stringify(S));
  } catch (e) {
    S.chat = S.chat.slice(-25);
    try { localStorage.setItem('ga', JSON.stringify(S)); } catch (e2) { /* sin almacenamiento disponible */ }
  }
}

const params = new URLSearchParams(location.search);
if (params.get('k')) S.k = params.get('k');
if (params.get('api')) S.api = params.get('api');

// ───────────────────────── API ─────────────────────────

class ErrorRed extends Error {}

async function api(accion, datos) {
  let r;
  try {
    r = await fetch(S.api, { method: 'POST', body: JSON.stringify({ k: S.k, accion, datos: datos || {} }) });
  } catch (e) {
    throw new ErrorRed('Sin conexión');
  }
  if (!r.ok) throw new ErrorRed('El servidor no responde (' + r.status + ')');
  let j;
  try { j = await r.json(); } catch (e) { throw new ErrorRed('Respuesta inválida del servidor'); }
  if (!j.ok) throw new Error(j.error || 'Error desconocido');
  return j.resultado;
}

// ───────────────────────── Navegación ─────────────────────────

const TITULOS_VISTA = { cargar: 'Cargar', panel: 'Panel', liquidacion: 'Liquidación Albardón', validar: 'Validar', ayuda: 'Ayuda' };

function ir(vista) {
  document.querySelectorAll('#nav button').forEach(b => {
    if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.vista').forEach(v => v.classList.toggle('activa', v.id === 'vista-' + vista));
  $('titulo').textContent = TITULOS_VISTA[vista];
  if (vista === 'panel') abrirPanel();
  if (vista === 'liquidacion') abrirLiquidacion();
  if (vista === 'validar') abrirValidar();
  if (vista === 'ayuda') abrirAyuda();
  if (vista === 'cargar') bajar();
}
document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => ir(b.dataset.vista)));

// ───────────────────────── Chat ─────────────────────────

const chat = $('chat'), texto = $('texto');
let foto = null;      // {full, mini} en base64

function bajar() { requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; }); }

function agregarItem(item) {
  item.id = item.id || uid();
  S.chat.push(item);
  pintar(item);
  bajar();
  return item;
}

function pintar(item) {
  let el = document.querySelector(`[data-item="${item.id}"]`);
  if (item.estado === 'descartado') { if (el) el.remove(); return; }
  const nuevo = document.createElement('div');
  nuevo.dataset.item = item.id;
  if (item.tipo === 'tarjeta') {
    nuevo.className = 'tarjeta';
    nuevo.innerHTML = htmlTarjeta(item);
  } else {
    nuevo.className = 'msg ' + (item.tipo === 'yo' ? 'yo' : 'bot') + (item.error ? ' error' : '');
    nuevo.innerHTML = (item.imagen ? `<img src="data:image/jpeg;base64,${item.imagen}" alt="">` : '') + esc(item.texto) +
      (item.tipo === 'yo' && !item.enviado ? '<span class="estado-envio">🕓 sin enviar</span>' : '');
  }
  if (el) el.replaceWith(nuevo); else chat.appendChild(nuevo);
  if (item.tipo === 'tarjeta') conectarTarjeta(nuevo, item);
}

function pintarTodo() {
  chat.innerHTML = '';
  S.chat.forEach(pintar);
  bajar();
}

let escribiendo = null;
function mostrarEscribiendo(si) {
  if (si && !escribiendo) {
    escribiendo = document.createElement('div');
    escribiendo.className = 'msg bot';
    escribiendo.textContent = 'Interpretando…';
    chat.appendChild(escribiendo);
    bajar();
  } else if (!si && escribiendo) {
    escribiendo.remove();
    escribiendo = null;
  }
}

function enviar() {
  const t = texto.value.trim();
  if (!t && !foto) return;
  const item = agregarItem({ tipo: 'yo', texto: t, imagen: foto ? foto.mini : null, enviado: false });
  S.hilo.push({ rol: 'user', texto: t, imagen: foto ? foto.full : null, itemId: item.id });
  if (!S.cola.some(c => c.tipo === 'interpretar')) S.cola.push({ tipo: 'interpretar' });
  texto.value = ''; ajustar(); quitarFoto();
  persistir();
  procesarCola();
}

// ───────────────────────── Tarjetas ─────────────────────────

const TITULO_TIPO = { gasto: 'Gasto', insumo: 'Insumo', deuda: 'Compra a cuenta (deuda)', jorge: 'Días de Jorge', aporte_sergio: 'Aporte de Sergio', cheque_recibido: 'Cheque a cobrar', mantenimiento: 'Mantenimiento' };
const ini = () => S.ini || { fincas: ['Angaco'], categorias: [], medios: [], movimientos: [], unidades: [], cuadros: [], productos: [], personas: [], proveedores: [] };
const cuadrosDe = finca => ['', ...ini().cuadros.filter(c => c.finca === finca).map(c => c.cuadro)];

const CAMPOS = {
  gasto: [
    { k: 'finca', et: 'Finca', t: 'select', op: () => ini().fincas },
    { k: 'fecha', et: r => r.medio_pago === 'Cheque' ? 'Fecha de cobro' : 'Fecha de pago', t: 'date', si: r => r.medio_pago !== 'Cheque de terceros' },
    { k: 'detalle', et: 'Detalle', t: 'text', ancho: true },
    { k: 'categoria', et: 'Categoría', t: 'select', op: () => ini().categorias, ancho: true, si: () => !!ini().admin },
    { k: 'monto', et: 'Monto ($)', t: 'number' },
    { k: 'medio_pago', et: 'Medio de pago', t: 'select', op: () => ini().medios },
    { k: 'cheque_numero', et: r => r.medio_pago === 'Cheque' ? 'Nº de cheque' : 'Nº del cheque endosado', t: 'text', si: r => /^Cheque/.test(r.medio_pago) },
    { k: 'librador', et: 'Cheque de (quién lo dio)', t: 'text', si: r => r.medio_pago === 'Cheque de terceros' },
    { k: 'cheque_emision', et: 'Entregado el', t: 'date', si: r => r.medio_pago === 'Cheque' },
    { k: 'persona', et: 'Persona', t: 'select', op: () => ['', ...ini().personas] },
    { k: 'cuadro', et: 'Cuadro', t: 'select', op: r => cuadrosDe(r.finca) },
    { k: 'proveedor', et: 'Proveedor', t: 'text', lista: () => ini().proveedores, ancho: true },
    { k: 'cuenta_corriente', et: 'Cancela deuda en cuenta corriente', t: 'check', ancho: true, si: r => !!r.proveedor },
    { k: 'factura', et: 'Factura', t: 'select', op: () => ['No', 'Si'] },
    { k: 'inversion', et: 'Inversión (costo de una vez, no se repite)', t: 'check', ancho: true, si: () => !!ini().admin },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  insumo: [
    { k: 'movimiento', et: 'Movimiento', t: 'select', op: () => ini().movimientos, ancho: true },
    { k: 'producto', et: 'Producto', t: 'select', op: () => ini().productos },
    { k: 'fecha', et: 'Fecha', t: 'date' },
    { k: 'cantidad', et: 'Cantidad', t: 'number' },
    { k: 'unidad', et: 'Unidad', t: 'select', op: () => ini().unidades },
    { k: 'contenido_envase', et: r => r.unidad === 'bolsas' ? 'Kg por bolsa' : 'Litros por bidón', t: 'number', si: r => r.unidad === 'bolsas' || r.unidad === 'bidones' },
    { k: 'finca', et: r => r.movimiento === 'Préstamo a otra finca' ? 'Finca que presta' : 'Finca', t: 'select', op: () => ini().fincas },
    { k: 'finca_destino', et: r => r.movimiento === 'Préstamo a otra finca' ? 'Finca que recibe' : 'Finca que devuelve', t: 'select', op: () => ['', ...ini().fincas], si: r => /Préstamo|Devolución/.test(r.movimiento) },
    { k: 'cuadro', et: 'Cuadro', t: 'select', op: r => cuadrosDe(r.finca), si: r => r.movimiento === 'Aplicación' },
    { k: 'proveedor', et: 'Proveedor', t: 'text', lista: () => ini().proveedores, si: r => r.movimiento === 'Compra' || r.movimiento === 'Entrega' },
    { k: 'remito', et: 'Remito', t: 'text', si: r => r.movimiento === 'Entrega' },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  deuda: [
    { k: 'proveedor', et: 'Proveedor', t: 'text', lista: () => ini().proveedores, ancho: true },
    { k: 'detalle', et: 'Detalle', t: 'text', ancho: true },
    { k: 'monto', et: 'Monto ($)', t: 'number' },
    { k: 'fecha', et: 'Fecha', t: 'date' },
    { k: 'finca', et: 'Finca', t: 'select', op: () => ini().fincas },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  jorge: [
    { k: 'fecha', et: 'Semana del viernes', t: 'date', ancho: true },
    { k: 'dias_angaco', et: 'Días Angaco', t: 'number' },
    { k: 'dias_albardon', et: 'Días Albardón', t: 'number' },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  aporte_sergio: [
    { k: 'monto', et: 'Monto ($)', t: 'number' },
    { k: 'fecha', et: 'Fecha', t: 'date' },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  mantenimiento: [
    { k: 'rodado', et: 'Rodado', t: 'select', op: () => ['', ...(ini().rodados || [])] },
    { k: 'trabajo', et: 'Trabajo', t: 'select', op: () => ini().trabajos || [] },
    { k: 'detalle', et: 'Qué se hizo', t: 'text', ancho: true },
    { k: 'fecha', et: 'Fecha', t: 'date' },
    { k: 'horas_km', et: 'Horas / km', t: 'number' },
    { k: 'taller', et: 'Quién lo hizo', t: 'text', ancho: true },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ],
  cheque_recibido: [
    { k: 'librador', et: 'De quién', t: 'text', ancho: true },
    { k: 'monto', et: 'Monto ($)', t: 'number' },
    { k: 'fecha', et: 'Fecha de cobro', t: 'date' },
    { k: 'banco', et: 'Banco', t: 'text' },
    { k: 'cheque_numero', et: 'Nº de cheque', t: 'text' },
    { k: 'notas', et: 'Notas', t: 'text', ancho: true }
  ]
};

function resumenRegistro(r) {
  if (r.tipo === 'gasto') return `${r.detalle} · ${peso(r.monto)} · ${r.finca} · ${r.medio_pago}${r.medio_pago === 'Cheque' ? ' (cobro ' + fechaCorta(r.fecha) + ')' : ''}${r.inversion ? ' · inversión' : ''}`;
  if (r.tipo === 'insumo') return `${r.movimiento}: ${r.producto} ${num(r.cantidad, 2)} ${r.unidad}${r.cuadro ? ' · cuadro ' + r.cuadro : ''} · ${r.finca}`;
  if (r.tipo === 'deuda') return `Deuda ${r.proveedor} · ${peso(r.monto)}`;
  if (r.tipo === 'jorge') return `Jorge: ${r.dias_angaco} días Angaco, ${r.dias_albardon} Albardón (semana ${fechaCorta(r.fecha)})`;
  if (r.tipo === 'mantenimiento') return `${r.rodado}: ${r.trabajo} · ${r.detalle}${r.horas_km ? ' · ' + num(r.horas_km, 0) + ' h/km' : ''}`;
  if (r.tipo === 'cheque_recibido') return `Cheque de ${r.librador} · ${peso(r.monto)} · cobro ${fechaCorta(r.fecha)}`;
  return `Aporte de Sergio · ${peso(r.monto)}`;
}

function htmlTarjeta(item) {
  const r = item.registro;
  if (item.estado === 'guardado' || item.estado === 'anulado' || item.estado === 'en_cola') {
    const icono = { guardado: '✅', anulado: '↩️', en_cola: '🕓' }[item.estado];
    const sub = item.estado === 'en_cola' ? 'Se guarda cuando haya señal' : item.estado === 'anulado' ? 'Anulado' : item.mensaje;
    const puedeDeshacer = item.estado === 'guardado' && (ini().admin || Date.now() - (item.guardadoEn || 0) < 3600e3);
    return `<div class="hecho"><span>${icono} ${esc(resumenRegistro(r))}<br><small>${esc(sub || '')}</small></span>
      ${puedeDeshacer ? '<button class="secundario chico" data-accion="deshacer">Deshacer</button>' : ''}</div>
      ${item.error ? `<div class="aviso">⚠️ ${esc(item.error)}</div>` : ''}`;
  }
  const titulo = TITULO_TIPO[r.tipo] + (r.tipo === 'insumo' && r.movimiento ? ' · ' + r.movimiento : '');
  const campos = CAMPOS[r.tipo].map(c => {
    const visible = !c.si || c.si(r);
    const et = typeof c.et === 'function' ? c.et(r) : c.et;
    const clase = (c.ancho ? 'ancho' : '') + (visible ? '' : ' oculto');
    const v = r[c.k] == null ? '' : r[c.k];
    if (c.t === 'check') return `<label class="check ${clase}"><input type="checkbox" data-k="${c.k}" ${v ? 'checked' : ''}> ${esc(et)}</label>`;
    if (c.t === 'select') {
      const ops = c.op(r).map(String);
      if (v !== '' && !ops.includes(String(v))) ops.push(String(v));
      return `<label class="${clase}">${esc(et)}<select data-k="${c.k}">${ops.map(o =>
        `<option value="${esc(o)}"${String(o) === String(v) ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    }
    const lista = c.lista ? `list="dl-${item.id}-${c.k}"` : '';
    const dl = c.lista ? `<datalist id="dl-${item.id}-${c.k}">${c.lista().map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
    const extra = c.t === 'number' ? 'inputmode="decimal" step="any"' : '';
    return `<label class="${clase}">${esc(et)}<input type="${c.t}" data-k="${c.k}" value="${esc(v)}" ${extra} ${lista}>${dl}</label>`;
  }).join('');
  const dudas = (r.confianza < 0.75 ? `<div class="aviso">Revisalo bien: no estoy seguro (${Math.round(r.confianza * 100)}%).</div>` : '') +
    (ini().admin && r.duda_clasificacion ? `<div class="aviso">🏷️ Duda de clasificación: ${esc(r.duda_clasificacion)}${r.alternativas ? ' · Alternativas: ' + esc(r.alternativas) : ''}</div>` : '');
  const error = item.error ? `<div class="aviso">⚠️ ${esc(item.error)}</div>` : '';
  return `<h3>${esc(titulo)}</h3>${campos}${dudas}${error}
    <div class="botones"><button class="secundario" data-accion="descartar">Descartar</button><button class="primario" data-accion="guardar">Guardar</button></div>`;
}

const REPINTAR = ['medio_pago', 'movimiento', 'unidad', 'finca', 'proveedor'];

function conectarTarjeta(el, item) {
  el.querySelectorAll('[data-k]').forEach(inp => {
    const evento = inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'date' ? 'change' : 'input';
    inp.addEventListener(evento, () => {
      const k = inp.dataset.k;
      item.registro[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      if (k === 'categoria' && !(ini().inversionDepende || []).includes(inp.value)) {
        item.registro.inversion = (ini().inversiones || []).includes(inp.value);
        pintar(item);
      }
      persistir();
      if (REPINTAR.includes(k) && evento === 'change') pintar(item);
    });
    if (REPINTAR.includes(inp.dataset.k) && inp.tagName !== 'SELECT') inp.addEventListener('change', () => pintar(item));
  });
  const b = sel => el.querySelector(`[data-accion="${sel}"]`);
  if (b('descartar')) b('descartar').onclick = () => { item.estado = 'descartado'; pintar(item); persistir(); };
  if (b('guardar')) b('guardar').onclick = () => guardarTarjeta(item);
  if (b('deshacer')) b('deshacer').onclick = () => {
    if (!confirm('¿Anular este registro?')) return;
    item.error = '';
    S.cola.push({ tipo: 'deshacer', itemId: item.id });
    persistir(); procesarCola();
    b('deshacer').disabled = true;
  };
}

function guardarTarjeta(item) {
  item.regId = item.regId || uid();
  item.error = '';
  item.estado = 'en_cola';
  S.cola.push({ tipo: 'guardar', itemId: item.id });
  pintar(item);
  persistir();
  procesarCola();
}

// ───────────────────────── Cola de envío (funciona sin señal) ─────────────────────────

let procesando = false;
let sinRed = false;

async function procesarCola() {
  if (procesando || !S.k || !S.api) return;
  procesando = true;
  try {
    while (S.cola.length) {
      const tarea = S.cola[0];
      mostrarEscribiendo(tarea.tipo === 'interpretar');
      try {
        await ejecutar(tarea);
        sinRed = false;
        S.cola.shift();
      } catch (e) {
        if (e instanceof ErrorRed) { sinRed = true; break; }
        S.cola.shift();
        errorDeTarea(tarea, e.message);
      }
      persistir();
      actualizarAviso();
    }
  } finally {
    procesando = false;
    mostrarEscribiendo(false);
    actualizarAviso();
  }
}

async function ejecutar(tarea) {
  if (tarea.tipo === 'interpretar') {
    if (!S.hilo.some(m => m.rol === 'user')) return;
    const r = await api('interpretar', { hilo: S.hilo.map(({ rol, texto, imagen }) => ({ rol, texto, imagen })) });
    mostrarEscribiendo(false);
    S.hilo.forEach(m => {
      const it = S.chat.find(i => i.id === m.itemId);
      if (it && !it.enviado) { it.enviado = true; pintar(it); }
    });
    if (r.respuesta) agregarItem({ tipo: 'bot', texto: r.respuesta });
    if (r.registros.length) {
      const usuario = S.hilo.filter(m => m.rol === 'user');
      const grupo = {
        entrada: usuario.map(m => (m.imagen ? '[foto] ' : '') + m.texto).join(' / '),
        imagen: (usuario.find(m => m.imagen) || {}).imagen || null
      };
      const grupoId = uid();
      S.grupos[grupoId] = grupo;
      r.registros.forEach(reg => agregarItem({ tipo: 'tarjeta', grupoId, registro: reg, original: Object.assign({}, reg), estado: 'editando' }));
      S.hilo = [];
    } else if (r.pregunta) {
      agregarItem({ tipo: 'bot', texto: r.pregunta });
      S.hilo.push({ rol: 'assistant', texto: r.pregunta });
    } else {
      S.hilo = [];
    }
  } else if (tarea.tipo === 'guardar') {
    const item = S.chat.find(i => i.id === tarea.itemId);
    if (!item) return;
    const grupo = S.grupos[item.grupoId] || {};
    const r = await api('guardar', {
      registro: item.registro, original: item.original, id: item.regId, grupo: item.grupoId,
      entrada: grupo.entrada || '', imagen: grupo.imagen || null
    });
    item.estado = 'guardado';
    item.mensaje = r.mensaje;
    item.guardadoEn = Date.now();
    pintar(item);
  } else if (tarea.tipo === 'deshacer') {
    const item = S.chat.find(i => i.id === tarea.itemId);
    if (!item) return;
    await api('deshacer', { id: item.regId });
    item.estado = 'anulado';
    pintar(item);
  }
}

function errorDeTarea(tarea, mensaje) {
  if (tarea.tipo === 'interpretar') {
    agregarItem({ tipo: 'bot', texto: '⚠️ No pude procesar el mensaje: ' + mensaje + '\nProbá escribirlo de nuevo.', error: true });
    S.hilo.forEach(m => {
      const it = S.chat.find(i => i.id === m.itemId);
      if (it) { it.enviado = true; pintar(it); }
    });
    S.hilo = [];
    return;
  }
  const item = S.chat.find(i => i.id === tarea.itemId);
  if (!item) return;
  item.error = mensaje;
  if (tarea.tipo === 'guardar') item.estado = 'editando';
  pintar(item);
}

function actualizarAviso() {
  const n = S.hilo.filter(m => m.rol === 'user' && S.chat.some(i => i.id === m.itemId && !i.enviado)).length +
    S.cola.filter(c => c.tipo !== 'interpretar').length;
  const visible = n > 0 && sinRed;
  $('aviso-cola').classList.toggle('visible', visible);
  if (visible) $('aviso-cola-texto').textContent = `🕓 ${n} ${n === 1 ? 'cosa pendiente' : 'cosas pendientes'} de envío. Se mandan solas cuando haya señal.`;
}

$('reintentar').onclick = () => procesarCola();
window.addEventListener('online', () => procesarCola());
document.addEventListener('visibilitychange', () => { if (!document.hidden) procesarCola(); });
setInterval(() => { if (S.cola.length) procesarCola(); }, 30000);

// ───────────────────────── Fotos y entrada de texto ─────────────────────────

function comprimir(file, max, calidad) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', calidad).split(',')[1]);
    };
    img.onerror = ko;
    img.src = URL.createObjectURL(file);
  });
}

$('foto').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    foto = { full: await comprimir(f, 1568, 0.82), mini: await comprimir(f, 240, 0.7) };
    $('miniatura').src = 'data:image/jpeg;base64,' + foto.mini;
    $('adjunto').classList.add('visible');
  } catch (err) {
    agregarItem({ tipo: 'bot', texto: '⚠️ No pude leer la imagen.', error: true });
  }
};
function quitarFoto() { foto = null; $('adjunto').classList.remove('visible'); }
$('quitar').onclick = quitarFoto;
function ajustar() { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 140) + 'px'; }
texto.addEventListener('input', ajustar);
texto.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); enviar(); }
});
$('enviar').onclick = enviar;

// ───────────────────────── Inicio ─────────────────────────

async function iniciar() {
  if (!S.k || !S.api) { $('bloqueo').classList.add('visible'); return; }
  persistir();
  if (!S.chat.length) {
    S.chat.push({ id: uid(), tipo: 'bot', texto: 'Hola. Contame qué pasó, como si mandaras un WhatsApp:\n• "Le pagué 150 mil a Pedro"\n• "Gasoil para el tractor 85 mil"\n• "Hoy inyectamos 160 litros de Guenta en el cuadro 2"\n• o mandá foto del ticket o remito 📷\n\nPara dictar, tocá el micrófono del teclado.' });
  }
  pintarTodo();
  aplicarInicio();
  try {
    S.ini = await api('inicio');
    persistir();
    aplicarInicio();
  } catch (e) {
    if (!(e instanceof ErrorRed)) agregarItem({ tipo: 'bot', texto: '⚠️ ' + e.message, error: true });
  }
  procesarCola();
}

function aplicarInicio() {
  if (!S.ini) return;
  $('usuario').textContent = S.ini.usuario;
  document.querySelectorAll('[data-admin]').forEach(b => { b.hidden = !S.ini.admin; });
  S.chat.filter(i => i.tipo === 'tarjeta' && i.estado === 'editando').forEach(pintar);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('DOMContentLoaded', iniciar);
