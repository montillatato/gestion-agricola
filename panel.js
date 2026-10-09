'use strict';
/* Panel: costos, fertilización, personal y cuentas. Muestra lo último guardado si no hay señal. */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SECCIONES = [['agenda', 'Agenda'], ['costos', 'Costos'], ['fert', 'Fertilización'], ['rodados', 'Rodados'], ['personal', 'Personal'], ['cuentas', 'Cuentas']];
const P = { seccion: S.seccionPanel || 'agenda', periodo: '12m', finca: '', categoria: '', moneda: 'ars', fincaFert: 'Angaco' };
let cargandoPanel = false;

async function abrirPanel() {
  pintarPanel();
  if (cargandoPanel) return;
  cargandoPanel = true;
  try {
    S.panel = await api('panel');
    S.panelHora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    persistir();
  } catch (e) {
    S.panelError = e instanceof ErrorRed ? 'Sin señal: mostrando los últimos datos guardados.' : e.message;
  } finally {
    cargandoPanel = false;
  }
  pintarPanel();
  S.panelError = '';
}

function pintarPanel() {
  const el = $('panel');
  const d = S.panel;
  const seg = `<div class="seg" role="group">${SECCIONES.map(([k, et]) =>
    `<button data-sec="${k}" aria-pressed="${P.seccion === k}">${et}</button>`).join('')}</div>`;
  const estado = S.panelError ? `<div class="aviso">${esc(S.panelError)}</div>` :
    cargandoPanel ? '<p class="vacio">Actualizando…</p>' : (S.panelHora ? `<p class="vacio" style="margin:0">Actualizado ${S.panelHora}</p>` : '');
  let cuerpo = '';
  if (d) {
    const errores = (d.errores || []).map(e => `<div class="aviso">No se pudo leer: ${esc(e)}</div>`).join('');
    cuerpo = errores + ({ agenda: htmlAgenda, costos: htmlCostos, fert: htmlFert, rodados: htmlRodados, personal: htmlPersonal, cuentas: htmlCuentas }[P.seccion] || htmlCostos)(d);
  }
  el.innerHTML = seg + estado + cuerpo;
  el.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { P.seccion = S.seccionPanel = b.dataset.sec; persistir(); pintarPanel(); });
  el.querySelectorAll('[data-filtro]').forEach(s => s.onchange = () => { P[s.dataset.filtro] = s.value; pintarPanel(); });
  el.querySelectorAll('[data-hecho]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Marcar como hecho? Se marca para los dos.')) return;
    b.disabled = true;
    try {
      const r = await api('marcarHecho', { origen: b.dataset.origen, id: b.dataset.hecho });
      S.panel.agenda = S.panel.agenda.filter(x => !(x.id === b.dataset.hecho && x.origen === b.dataset.origen));
      persistir(); pintarPanel(); abrirPanel();
      if (r.mensaje && r.mensaje !== 'Hecho.') alert(r.mensaje);
    } catch (e) { alert(e instanceof ErrorRed ? 'Sin señal: probá de nuevo cuando haya.' : e.message); b.disabled = false; }
  });
  el.querySelectorAll('[data-desmarcar]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Volver a dejarlo pendiente?')) return;
    b.disabled = true;
    try { await api('desmarcar', { origen: b.dataset.origen, id: b.dataset.desmarcar }); abrirPanel(); }
    catch (e) { alert(e instanceof ErrorRed ? 'Sin señal: probá de nuevo cuando haya.' : e.message); b.disabled = false; }
  });
}

// ───────────────────────── Costos ─────────────────────────

function rangoPeriodo() {
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth();
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  switch (P.periodo) {
    case 'mes': return [iso(new Date(y, m, 1)), iso(hoy)];
    case 'mesant': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case '3m': return [iso(new Date(y, m - 2, 1)), iso(hoy)];
    case '12m': return [iso(new Date(y, m - 11, 1)), iso(hoy)];
    case 'camp': { const desde = m >= 4 ? y : y - 1; return [`${desde}-05-01`, `${desde + 1}-04-30`]; }
    case 'campant': { const desde = (m >= 4 ? y : y - 1) - 1; return [`${desde}-05-01`, `${desde + 1}-04-30`]; }
    default: return ['0000', '9999'];
  }
}

function htmlCostos(d) {
  const fincas = ini().fincas;
  const colorFinca = f => `var(--s${fincas.indexOf(f) + 1})`;
  const [desde, hasta] = rangoPeriodo();
  const valor = g => P.moneda === 'usd' ? g[4] : g[3];
  const filas = d.costos.filter(g => g[1] >= desde && g[1] <= hasta && (!P.finca || g[0] === P.finca) && (!P.categoria || g[2] === P.categoria));
  const total = filas.reduce((a, g) => a + valor(g), 0);
  const inversion = filas.reduce((a, g) => a + (g[5] ? valor(g) : 0), 0);
  const meses = new Set(filas.map(g => g[1].slice(0, 7))).size || 1;
  const fmt = n => (P.moneda === 'usd' ? 'US$ ' : '$ ') + Math.round(n).toLocaleString('es-AR');
  const cats = [...new Set(d.costos.map(g => g[2]))].sort((a, b) => a.localeCompare(b, 'es'));
  const opt = (v, et, actual) => `<option value="${esc(v)}"${v === actual ? ' selected' : ''}>${esc(et)}</option>`;

  const filtros = `<div class="filtros">
    <select data-filtro="periodo">${[['camp', 'Esta campaña'], ['campant', 'Campaña anterior'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'],
      ['3m', 'Últimos 3 meses'], ['12m', 'Últimos 12 meses'], ['todo', 'Todo']].map(([v, et]) => opt(v, et, P.periodo)).join('')}</select>
    <select data-filtro="finca">${opt('', 'Todas las fincas', P.finca)}${fincas.map(f => opt(f, f, P.finca)).join('')}</select>
    <select data-filtro="categoria">${opt('', 'Todas las categorías', P.categoria)}${cats.map(c => opt(c, c, P.categoria)).join('')}</select>
    <select data-filtro="moneda">${opt('ars', 'Pesos', P.moneda)}${opt('usd', 'Dólares (MEP)', P.moneda)}</select></div>`;

  const kpis = `<div class="kpis">
    <div class="kpi"><span>Total del período</span><b>${fmt(total)}</b></div>
    <div class="kpi"><span>Costo de producción</span><b>${fmt(total - inversion)}</b></div>
    <div class="kpi"><span>Inversiones (costos de una vez)</span><b>${fmt(inversion)}</b></div>
    <div class="kpi"><span>Promedio por mes</span><b>${fmt(total / meses)}</b></div>
    <div class="kpi"><span>Cantidad de gastos</span><b>${filas.length.toLocaleString('es-AR')}</b></div>
    <div class="kpi${d.pendientes ? ' alerta' : ''}"><span>Pendientes de validar</span><b>${d.pendientes}</b></div></div>`;

  // Evolución mensual apilada por finca
  const porMes = {};
  filas.forEach(g => { const k = g[1].slice(0, 7); (porMes[k] = porMes[k] || {})[g[0]] = (porMes[k][g[0]] || 0) + valor(g); });
  let claves = Object.keys(porMes).sort();
  let evolucion = '<p class="vacio">Sin gastos en este período.</p>';
  if (claves.length) {
    const todos = [];
    for (let [y, m] = claves[0].split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= claves[claves.length - 1]; m === 12 ? (y++, m = 1) : m++) {
      todos.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    claves = todos.slice(-24);
    const presentes = fincas.filter(f => claves.some(k => porMes[k] && porMes[k][f]));
    const totales = claves.map(k => Object.values(porMes[k] || {}).reduce((a, b) => a + b, 0));
    const max = Math.max(...totales) || 1;
    const corto = n => n >= 1e6 ? num(n / 1e6) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : Math.round(n);
    const et = (k, i) => {
      const mes = MESES[Number(k.slice(5)) - 1];
      if (claves.length > 12 && i % 2) return '';
      return i === 0 || k.endsWith('-01') ? mes + ' ' + k.slice(2, 4) : mes;
    };
    evolucion = (presentes.length > 1 ? `<div class="leyenda">${presentes.map(f => `<span><i style="background:${colorFinca(f)}"></i>${esc(f)}</span>`).join('')}</div>` : '') +
      `<div class="columnas">${[0.5, 1].map(p => `<div class="linea" style="bottom:${p * 100 * (182 / 200)}%"><span>${corto(max * p)}</span></div>`).join('')}
      ${claves.map((k, i) => {
        const partes = presentes.filter(f => porMes[k] && porMes[k][f]);
        const tip = `<b>${et(k, 0)}</b> · ${fmt(totales[i])}` + (partes.length > 1 ? '<br>' + partes.map(f => `${esc(f)}: ${fmt(porMes[k][f])}`).join('<br>') : '');
        return `<div class="col" data-tip="${esc(tip)}" style="height:${totales[i] / max * 100}%">${partes.map(f =>
          `<div class="seg-col" style="flex:${porMes[k][f]};background:${colorFinca(f)}"></div>`).join('')}</div>`;
      }).join('')}</div><div class="ejex">${claves.map((k, i) => `<span>${et(k, i)}</span>`).join('')}</div>`;
  }

  const sumar = idx => filas.reduce((a, g) => { a[g[idx]] = (a[g[idx]] || 0) + valor(g); return a; }, {});
  const porFinca = sumar(0);
  const catOrden = Object.entries(sumar(2)).sort((a, b) => b[1] - a[1]);
  const top = catOrden.slice(0, 10).map(([k, v]) => [k, v, 'var(--total)']);
  if (catOrden.length > 10) top.push([`Otras (${catOrden.length - 10})`, catOrden.slice(10).reduce((a, x) => a + x[1], 0), 'var(--muted)']);

  return filtros + kpis +
    `<div class="card"><h2>Evolución mensual</h2>${evolucion}</div>
     <div class="grid2"><div class="card"><h2>Por finca</h2>${barras(fincas.filter(f => porFinca[f]).map(f => [f, porFinca[f], colorFinca(f)]), total, fmt)}</div>
     <div class="card"><h2>Por categoría</h2>${barras(top, total, fmt)}</div></div>`;
}

function barras(items, total, fmt) {
  if (!items.length) return '<p class="vacio">Sin gastos en este período.</p>';
  const max = Math.max(...items.map(i => i[1]));
  const corto = n => (P.moneda === 'usd' ? 'US$ ' : '$ ') + (n >= 1e6 ? num(n / 1e6) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : Math.round(n));
  return '<div class="barras">' + items.map(([et, v, color]) => `
    <span class="et" title="${esc(et)}">${esc(et)}</span>
    <span class="pista" data-tip="${esc(`<b>${esc(et)}</b><br>${fmt(v)} · ${total ? Math.round(v / total * 100) : 0}% del total`)}">
      <span class="barra" style="width:${max ? v / max * 100 : 0}%;background:${color}"></span></span>
    <span class="val">${corto(v)}</span>`).join('') + '</div>';
}

// ───────────────────────── Fertilización ─────────────────────────

function htmlFert(d) {
  const f = d.fertilizacion;
  if (!f || !Object.keys(f.fincas).length) return '<div class="card"><p class="vacio">Todavía no hay plan ni movimientos de fertilización para esta campaña.</p></div>';
  const fincas = Object.keys(f.fincas);
  if (!fincas.includes(P.fincaFert)) P.fincaFert = fincas[0];
  const selector = fincas.length > 1 ? `<div class="filtros"><select data-filtro="fincaFert">${fincas.map(x =>
    `<option${x === P.fincaFert ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>` : '';
  const prods = f.fincas[P.fincaFert];
  const alertas = prods.filter(p => p.alerta).map(p => `<div class="aviso">⚠️ <b>${esc(p.producto)}:</b> ${esc(p.alerta)}</div>`).join('');

  const tarjetas = prods.map(p => {
    const u = p.unidad;
    const pct = p.plan ? Math.min(100, p.aplicado / p.plan * 100) : 0;
    const marca = p.plan ? Math.min(100, p.planHastaHoy / p.plan * 100) : 0;
    const enKg = v => u === 'L' && p.densidad ? ` <small>(${num(v * p.densidad, 0)} kg)</small>` : '';
    const cuadros = p.cuadros.length ? `<div class="tabla-scroll"><table><thead><tr><th>Cuadro</th><th class="num">Plan</th><th class="num">Aplicado</th><th class="num">%</th></tr></thead><tbody>${
      p.cuadros.map(c => `<tr><td>${esc(c.cuadro)}</td><td class="num">${num(c.plan)} ${u}</td><td class="num">${num(c.aplicado)} ${u}</td>
        <td class="num">${c.plan ? Math.round(c.aplicado / c.plan * 100) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '';
    const proveedores = p.proveedores.length ? `<h3 style="font-size:14px;margin:12px 0 4px">Proveedores</h3><div class="tabla-scroll"><table><thead><tr><th>Proveedor</th>
      <th class="num">Comprado</th><th class="num">Entregado</th><th class="num">Falta entregar</th></tr></thead><tbody>${p.proveedores.map(x =>
      `<tr><td>${esc(x.proveedor)}</td><td class="num">${num(x.comprado)}</td><td class="num">${num(x.entregado)}</td><td class="num"><b>${num(x.pendiente)}</b></td></tr>`).join('')}</tbody></table></div>` : '';
    const prestamos = p.prestamos.length ? `<p class="vacio">${p.prestamos.map(x => x.cantidad > 0
      ? `${esc(x.finca)} debe devolver ${num(x.cantidad)} ${u}` : `Debemos devolver ${num(-x.cantidad)} ${u} a ${esc(x.finca)}`).join(' · ')}</p>` : '';
    return `<div class="card">
      <h2>${esc(p.producto)} <small class="vacio">· ${esc(p.rubro)}</small></h2>
      <div class="progreso" data-tip="${esc(`Aplicado ${num(p.aplicado)} de ${num(p.plan)} ${u}<br>Debería ir en ${num(p.planHastaHoy)} ${u} a fin de este mes`)}">
        <div style="width:${pct}%"></div>${p.plan ? `<span class="marca" style="left:calc(${marca}% - 1px)"></span>` : ''}</div>
      <small class="vacio">${Math.round(pct)}% aplicado · la marca indica lo planificado hasta fin de este mes</small>
      <div class="cifras">
        <div><span>Plan campaña</span><b>${num(p.plan)} ${u}</b>${enKg(p.plan)}</div>
        <div><span>Aplicado</span><b>${num(p.aplicado)} ${u}</b></div>
        <div><span>Falta aplicar</span><b>${num(p.falta)} ${u}</b>${enKg(p.falta)}</div>
        <div><span>Stock en finca</span><b>${num(p.stock)} ${u}</b>${enKg(p.stock)}</div>
        <div><span>Falta que entreguen</span><b>${num(p.pendienteEntrega)} ${u}</b></div>
        <div><span>Falta comprar</span><b>${num(p.sinComprar)} ${u}</b></div>
        ${p.atraso ? `<div><span>Atraso vs plan</span><b style="color:var(--alerta)">${num(p.atraso)} ${u}</b></div>` : ''}
      </div>${cuadros}${proveedores}${prestamos}</div>`;
  }).join('');
  return selector + `<p class="vacio" style="margin:0">Campaña ${esc(f.campania)}</p>` + alertas + tarjetas;
}

// ───────────────────────── Agenda ─────────────────────────

function htmlAgenda(d) {
  const items = d.agenda || [];
  const hechos = d.agendaHechos || [];
  const htmlHechos = hechos.length ? `<div class="card"><h2>✅ Hechos (últimos 7 días)</h2><div class="tabla-scroll"><table><tbody>${hechos.map(x => `<tr>
      <td><b>${esc(x.tipo)}</b><br><small>${esc(x.detalle)}</small></td><td class="num">${x.monto ? peso(x.monto) : ''}</td>
      <td><small>${esc(x.por)}<br>${esc(x.cuando)}</small></td>
      <td><button class="secundario chico" data-desmarcar="${esc(x.id)}" data-origen="${esc(x.origen)}">↩︎</button></td></tr>`).join('')}</tbody></table></div></div>` : '';
  if (!items.length) return '<div class="card"><p class="vacio">No hay nada pendiente. Ejemplo: "Recordame pagar los intereses del préstamo, 350 mil, el 10 de cada mes".</p></div>' + htmlHechos;
  const hoy = hoyIso();
  const en = n => { const x = new Date(); x.setDate(x.getDate() + n); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const grupos = [
    ['⚠️ Vencidos', items.filter(x => x.fecha < hoy)],
    ['📌 Hoy', items.filter(x => x.fecha === hoy)],
    ['Próximos 7 días', items.filter(x => x.fecha > hoy && x.fecha <= en(7))],
    ['Próximos 30 días', items.filter(x => x.fecha > en(7) && x.fecha <= en(30))],
    ['Más adelante', items.filter(x => x.fecha > en(30))]
  ].filter(([, l]) => l.length);
  const total = (l, origen) => l.filter(x => x.origen === origen).reduce((a, x) => a + x.monto, 0);
  return grupos.map(([titulo, l]) => {
    const cubrir = total(l, 'cheque_cubrir'), cobrar = total(l, 'cheque_cobrar');
    return `<div class="card"><h2>${titulo}</h2>
      ${cubrir || cobrar ? `<p class="vacio" style="margin-top:0">${cubrir ? 'A cubrir: <b>' + peso(cubrir) + '</b>' : ''}${cubrir && cobrar ? ' · ' : ''}${cobrar ? 'A cobrar: <b>' + peso(cobrar) + '</b>' : ''}</p>` : ''}
      <div class="tabla-scroll"><table><tbody>${l.map(x => `<tr>
        <td>${fechaCorta(x.fecha)}</td>
        <td><b>${esc(x.tipo)}</b><br><small>${esc(x.detalle)}${x.recurrencia && x.recurrencia !== 'Única' ? ' · ' + esc(x.recurrencia.toLowerCase()) : ''}</small></td>
        <td class="num">${x.monto ? peso(x.monto) : ''}</td>
        <td><button class="secundario chico" data-hecho="${esc(x.id)}" data-origen="${esc(x.origen)}" aria-label="Marcar como hecho">✓</button></td>
      </tr>`).join('')}</tbody></table></div></div>`;
  }).join('') + htmlHechos;
}

// ───────────────────────── Rodados ─────────────────────────

function htmlRodados(d) {
  const lista = d.rodados || [];
  if (!lista.length) return '<div class="card"><p class="vacio">Todavía no hay rodados cargados. Tato los agrega en la hoja "Rodados" de la base.</p></div>';
  return lista.map(r => `<div class="card"><h2>${esc(r.rodado)}</h2>${r.ultimos.length ? `
    <div class="tabla-scroll"><table><thead><tr><th>Último…</th><th>Fecha</th><th class="num">Horas / km</th></tr></thead><tbody>${
      r.ultimos.map(u => `<tr><td>${esc(u.trabajo)}<br><small class="vacio">${esc(u.detalle)}</small></td><td>${fechaCorta(u.fecha)}</td>
        <td class="num">${u.horasKm !== '' && u.horasKm != null ? num(u.horasKm, 0) : '—'}</td></tr>`).join('')}</tbody></table></div>
    ${r.historial.length > r.ultimos.length ? `<details><summary class="vacio">Historial (${r.historial.length})</summary><table><tbody>${
      r.historial.map(h => `<tr><td>${fechaCorta(h.fecha)}</td><td>${esc(h.trabajo)} · ${esc(h.detalle)}${h.taller ? ' · ' + esc(h.taller) : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}`
    : '<p class="vacio">Sin trabajos registrados.</p>'}</div>`).join('');
}

// ───────────────────────── Personal ─────────────────────────

function htmlPersonal(d) {
  const j = d.jorge;
  if (!j || !j.semanas.length) return '<div class="card"><h2>Jorge Aguilera</h2><p class="vacio">Todavía no hay días cargados. Ejemplo: "Jorge esta semana 3 días en Angaco y 2 en Albardón".</p></div>';
  const nombreMes = k => MESES[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4);
  const nombreSem = k => (k.endsWith('1S') ? '1er semestre ' : '2do semestre ') + k.slice(0, 4);
  const tabla = (filas, etiqueta) => `<div class="tabla-scroll"><table><thead><tr><th>Período</th><th class="num">Angaco</th>
    <th class="num">Albardón</th><th class="num">% Angaco</th><th class="num">% Albardón</th></tr></thead><tbody>${filas.map(f =>
    `<tr><td>${esc(etiqueta(f.periodo))}</td><td class="num">${num(f.angaco)}</td><td class="num">${num(f.albardon)}</td>
     <td class="num">${num(f.pctAngaco)}%</td><td class="num">${num(100 - f.pctAngaco)}%</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="card"><h2>Jorge Aguilera · días por semestre</h2><p class="vacio" style="margin-top:0">Para el aguinaldo proporcional.</p>${tabla(j.semestres, nombreSem)}</div>
    <div class="card"><h2>Días por mes</h2><p class="vacio" style="margin-top:0">Para repartir cargas sociales.</p>${tabla(j.meses, nombreMes)}</div>
    <div class="card"><h2>Últimas semanas</h2><div class="tabla-scroll"><table><thead><tr><th>Viernes</th><th class="num">Angaco</th><th class="num">Albardón</th></tr></thead><tbody>${
      j.semanas.map(s => `<tr><td>${fechaCorta(s.semana)}</td><td class="num">${num(s.angaco)}</td><td class="num">${num(s.albardon)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ───────────────────────── Cuentas ─────────────────────────

function htmlCuentas(d) {
  const s = d.sergio;
  const sergio = s ? `<div class="card"><h2>Cuenta con Sergio (Albardón)</h2>
    <div class="kpis"><div class="kpi${s.saldo < 0 ? ' alerta' : ''}"><span>${s.saldo >= 0 ? 'Fondos de Sergio sin usar' : 'Sergio nos debe'}</span><b>${peso(Math.abs(s.saldo))}</b></div>
    ${s.ultimoAporte ? `<div class="kpi"><span>Último aporte (${fechaCorta(s.ultimoAporte.fecha)})</span><b>${peso(s.ultimoAporte.monto)}</b></div>` : ''}</div>
    ${s.gastosDesdeUltimoAporte.length ? `<h3 style="font-size:14px;margin:12px 0 4px">Gastos de Albardón desde el último aporte</h3><div class="tabla-scroll"><table><tbody>${
      s.gastosDesdeUltimoAporte.map(g => `<tr><td>${fechaCorta(g.fecha)}</td><td>${esc(g.detalle)}</td><td class="num">${peso(g.monto)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>` : '';
  const totalCh = d.cheques.reduce((a, c) => a + c.monto, 0);
  const cheques = `<div class="card"><h2>Cheques a cubrir${d.cheques.length ? ' · ' + peso(totalCh) : ''}</h2>${d.cheques.length ? `<div class="tabla-scroll"><table><thead><tr><th>Cobro</th><th>A</th><th>Nº</th><th class="num">Monto</th></tr></thead><tbody>${
    d.cheques.map(c => `<tr><td>${fechaCorta(c.cobro)}</td><td>${esc(c.proveedor)}</td><td>${esc(c.numero)}</td><td class="num">${peso(c.monto)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">No hay cheques pendientes.</p>'}</div>`;
  const lista = d.chequesCobrar || [];
  const totalCo = lista.reduce((a, c) => a + c.monto, 0);
  const hoy = hoyIso();
  const cobrar = `<div class="card"><h2>Cheques a cobrar${lista.length ? ' · ' + peso(totalCo) : ''}</h2>${lista.length ? `<div class="tabla-scroll"><table><thead><tr><th>Cobro</th><th>De</th><th>Banco / Nº</th><th class="num">Monto</th></tr></thead><tbody>${
    lista.map(c => `<tr><td>${fechaCorta(c.cobro)}${c.cobro <= hoy ? ' <b style="color:var(--alerta)">hoy</b>' : ''}</td><td>${esc(c.librador)}</td>
      <td>${esc([c.banco, c.numero].filter(Boolean).join(' · '))}</td><td class="num">${peso(c.monto)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">No hay cheques para cobrar.</p>'}</div>`;
  const proveedores = `<div class="card"><h2>Cuentas corrientes con proveedores</h2>${d.proveedores.length ? `<div class="tabla-scroll"><table><thead><tr><th>Proveedor</th><th class="num">Debemos</th></tr></thead><tbody>${
    d.proveedores.map(p => `<tr><td>${esc(p.proveedor)}</td><td class="num">${peso(p.saldo)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Sin saldos pendientes.</p>'}</div>`;
  const ultimos = `<div class="card"><h2>Últimos registros</h2>${d.ultimos.length ? `<div class="tabla-scroll"><table><tbody>${d.ultimos.map(u =>
    `<tr><td>${esc(u.registrado)}<br><small class="vacio">${esc(u.usuario)}</small></td><td>${esc(u.tipo)}<br><small>${esc(u.resumen)}</small></td><td>${esc(u.estado)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Sin registros todavía.</p>'}
    ${d.urlBase ? `<p><a href="${esc(d.urlBase)}" target="_blank" rel="noopener">Abrir la base completa ↗</a></p>` : ''}</div>`;
  return sergio + cheques + cobrar + proveedores + ultimos;
}

// ───────────────────────── Tooltip ─────────────────────────

(() => {
  const tip = $('tip');
  const mostrar = e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    tip.innerHTML = el.dataset.tip;
    tip.style.display = 'block';
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    const y = e.clientY - tip.offsetHeight - 12 < 0 ? e.clientY + 16 : e.clientY - tip.offsetHeight - 12;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = y + 'px';
  };
  document.addEventListener('pointermove', mostrar);
  document.addEventListener('pointerdown', mostrar);
  document.addEventListener('scroll', () => { tip.style.display = 'none'; }, true);
})();
