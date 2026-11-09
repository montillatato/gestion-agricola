'use strict';
/* Liquidación de Albardón, validación de registros y ayuda. */

// ───────────────────────── Liquidación Albardón ─────────────────────────

const L = { finca: 'Albardón', datos: null, valores: {}, gente: { 'Albardón': 0, 'Angaco': 0 }, otros: 0, otrosDetalle: '', detalle: true, error: '' };
const personasLiq = finca => finca === 'Angaco' ? L.datos.angaco.personas : L.datos.personas;
const claveLiq = (finca, persona) => finca + '|' + persona;

async function abrirLiquidacion() {
  const el = $('liquidacion');
  if (!L.datos) el.innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    L.datos = await api('liquidacion');
    L.error = '';
    ['Albardón', 'Angaco'].forEach(f => personasLiq(f).forEach(p => {
      const k = claveLiq(f, p.persona);
      if (!(k in L.valores)) L.valores[k] = p.porDia ? (p.diasSugeridos || 0) : p.sugerido;
    }));
  } catch (e) {
    L.error = e instanceof ErrorRed ? 'Sin señal. La liquidación necesita conexión.' : e.message;
  }
  pintarLiquidacion();
}

function lineasPersonal(finca) {
  const d = L.datos;
  const lineas = [];
  personasLiq(finca).forEach(p => {
    const v = Number(L.valores[claveLiq(finca, p.persona)]) || 0;
    if (p.porDia) {
      const dias = v;
      // Fijos: semanal ÷ 5,5 por día, calculado con el semanal para que 5,5 días den justo la semana.
      if (dias) lineas.push({ concepto: `${p.persona} (${num(dias)} días)`, monto: Math.round((p.semanal ? dias * p.semanal / 5.5 : dias * p.tarifa) * 100) / 100 });
    } else if (v) {
      lineas.push({ concepto: p.persona, monto: v });
    }
  });
  const gente = Number(L.gente[finca]) || 0;
  if (gente) lineas.push({ concepto: `Gente (${num(gente)} jornales)`, monto: gente * d.tarifaGente });
  return lineas;
}

function calcularLiquidacion() {
  const d = L.datos;
  const lineas = lineasPersonal('Albardón');
  if (Number(L.otros)) lineas.push({ concepto: L.otrosDetalle || 'Otros', monto: Number(L.otros) });
  const sueldos = lineas.reduce((a, l) => a + l.monto, 0);
  const saldo = d.sergio.saldo;
  return { lineas, sueldos, saldo, pedido: Math.round(sueldos - saldo) };
}

function mensajeSergio(c) {
  if (c.pedido <= 0) return `Sergio, esta semana no hace falta que mandes plata: con lo que quedó alcanza (sobran ${peso(-c.pedido)}).`;
  let m = `Sergio, para mañana hace falta ${peso(c.pedido)}.`;
  if (!L.detalle) return m;
  m += '\n\nDetalle:\n' + c.lineas.map(l => `• ${l.concepto}: ${peso(l.monto)}`).join('\n');
  if (c.saldo < 0) m += `\n• Gastos de la semana que pagamos nosotros: ${peso(-c.saldo)}`;
  if (c.saldo > 0) m += `\n• Menos sobrante de la semana anterior: -${peso(c.saldo)}`;
  return m;
}

function pintarLiquidacion() {
  const el = $('liquidacion');
  if (!L.datos) { el.innerHTML = `<div class="aviso">${esc(L.error || 'Sin datos.')}</div>`; return; }
  const d = L.datos, s = d.sergio, c = calcularLiquidacion(), finca = L.finca;
  const gastos = s.gastosDesdeUltimoAporte;
  const selector = `<div class="seg" role="group">${['Albardón', 'Angaco'].map(f => `<button data-liq-finca="${f}" aria-pressed="${f === finca}">${f}</button>`).join('')}</div>`;
  const valor = p => L.valores[claveLiq(finca, p.persona)];
  const filasPersonas = personasLiq(finca).map(p => p.porDia
    ? `<div class="fila-liq"><span>${esc(p.persona)} <small>(${peso(p.tarifa)}/día)</small></span>
        <input type="text" inputmode="decimal" autocomplete="off" data-persona="${esc(p.persona)}" value="${enCampo(valor(p) || '')}" placeholder="días">
        <small>Días en ${finca} · medio día = ,5${p.nota ? '<br>' + esc(p.nota) : ''}</small></div>`
    : `<div class="fila-liq"><span>${esc(p.persona)}</span>
        <input type="text" inputmode="decimal" autocomplete="off" data-persona="${esc(p.persona)}" value="${enCampo(valor(p) || '')}" placeholder="$">
        ${p.nota ? `<small>${esc(p.nota)}</small>` : ''}</div>`).join('');

  const filaGente = `<div class="fila-liq"><span>Gente sin nombre <small>(${peso(d.tarifaGente)}/jornal)</small></span>
        <input type="text" inputmode="decimal" autocomplete="off" id="liq-gente" value="${enCampo(L.gente[finca] || '')}" placeholder="jornales">
        <small>Total de jornales de la semana · medio día = ,5 (ej.: 4 personas lun–vie + sábado = 22)</small></div>`;
  const conectarComunes = () => {
    el.querySelectorAll('[data-liq-finca]').forEach(b => b.onclick = () => { L.finca = b.dataset.liqFinca; pintarLiquidacion(); });
    el.querySelectorAll('[data-persona]').forEach(i => i.onchange = () => { L.valores[claveLiq(finca, i.dataset.persona)] = aNumero(i.value) || 0; pintarLiquidacion(); });
    $('liq-gente').onchange = e => { L.gente[finca] = aNumero(e.target.value) || 0; pintarLiquidacion(); };
  };

  if (finca === 'Angaco') {
    const total = lineasPersonal('Angaco').reduce((a, l) => a + l.monto, 0);
    el.innerHTML = `${L.error ? `<div class="aviso">${esc(L.error)}</div>` : ''}${selector}
    <div class="card"><h2>Sueldos a pagar de la semana (Angaco)</h2>${filasPersonas}${filaGente}</div>
    <div class="card"><div class="total-liq grande" style="margin-top:0;padding-top:0;border-top:0"><span>Efectivo para el viernes</span><span>${peso(total)}</span></div></div>`;
    conectarComunes();
    return;
  }

  el.innerHTML = `${L.error ? `<div class="aviso">${esc(L.error)}</div>` : ''}${selector}
    <div class="card"><h2>Cuenta con Sergio</h2>
      <div class="total-liq"><span>${s.saldo >= 0 ? 'Fondos sin usar (sobrante)' : 'Gastos que pagamos nosotros'}</span><b>${peso(Math.abs(s.saldo))}</b></div>
      ${gastos.length ? `<details><summary class="vacio">Ver ${gastos.length} gastos desde el último aporte</summary><table><tbody>${gastos.map(g =>
        `<tr><td>${fechaCorta(g.fecha)}</td><td>${esc(g.detalle)}</td><td class="num">${peso(g.monto)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    </div>
    <div class="card"><h2>Sueldos a pagar de la semana (Albardón)</h2>
      ${filasPersonas}
      ${filaGente}
      <div class="fila-liq"><input class="campo" id="liq-otros-det" value="${esc(L.otrosDetalle)}" placeholder="Otro concepto (opcional)" style="text-align:left">
        <input type="text" inputmode="decimal" autocomplete="off" id="liq-otros" value="${enCampo(L.otros || '')}" placeholder="$"></div>
    </div>
    <div class="card">
      <div class="total-liq"><span>Sueldos</span><b>${peso(c.sueldos)}</b></div>
      <div class="total-liq"><span>${c.saldo >= 0 ? 'Menos sobrante' : 'Más gastos que pagamos'}</span><b>${c.saldo >= 0 ? '−' : '+'} ${peso(Math.abs(c.saldo))}</b></div>
      <div class="total-liq grande"><span>A pedirle a Sergio</span><span>${peso(Math.max(0, c.pedido))}</span></div>
      <label class="check" style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="liq-detalle" ${L.detalle ? 'checked' : ''}> Incluir detalle en el mensaje</label>
      <textarea class="campo" id="liq-mensaje" rows="7" readonly>${esc(mensajeSergio(c))}</textarea>
      <div class="botones" style="margin-top:8px">
        <button class="secundario" id="liq-copiar">Copiar mensaje</button>
        <a class="boton primario" style="flex:1" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(mensajeSergio(c))}">Abrir WhatsApp</a>
      </div>
      <p class="vacio">Cuando Sergio entregue la plata, cargalo en el chat: "Sergio mandó ${peso(Math.max(0, c.pedido)).replace('$ ', '')}".</p>
    </div>`;

  const re = () => pintarLiquidacion();
  conectarComunes();
  $('liq-otros').onchange = e => { L.otros = aNumero(e.target.value) || 0; re(); };
  $('liq-otros-det').onchange = e => { L.otrosDetalle = e.target.value; re(); };
  $('liq-detalle').onchange = e => { L.detalle = e.target.checked; re(); };
  $('liq-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText($('liq-mensaje').value); $('liq-copiar').textContent = 'Copiado ✓'; }
    catch (e) { $('liq-mensaje').select(); document.execCommand('copy'); $('liq-copiar').textContent = 'Copiado ✓'; }
  };
}

// ───────────────────────── Validar ─────────────────────────

let pendientes = null;
let dudas = [];
let credito = [];

async function abrirValidar() {
  const el = $('validar');
  if (!pendientes) el.innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    [pendientes, dudas, credito] = await Promise.all([api('pendientes'), api('dudas'), api('gastosCredito')]);
    pintarValidar();
  } catch (e) {
    el.innerHTML = `<div class="aviso">${esc(e instanceof ErrorRed ? 'Sin señal. Validar necesita conexión.' : e.message)}</div>`;
  }
}

function htmlDudas() {
  if (!dudas.length) return '';
  const cats = ini().categorias || [];
  return `<div class="card"><h2>🏷️ ${dudas.length} ${dudas.length === 1 ? 'gasto' : 'gastos'} con duda de clasificación</h2>
    <p class="vacio" style="margin-top:0">Confirmá o cambiá la categoría y si es inversión. Se corrige también en la planilla de la finca.</p>
    ${dudas.map(x => `<div class="pend" data-duda="${esc(x.id)}">
      <div class="meta">${esc(x.finca)} · ${fechaCorta(x.fecha)} · ${peso(x.monto)}</div>
      <div><b>${esc(x.detalle)}</b></div>
      <div class="entrada">Duda: ${esc(x.duda)}${x.alternativas ? ' · Alternativas: ' + esc(x.alternativas) : ''}</div>
      <select class="campo" data-cat>${cats.map(k => `<option${k === x.categoria ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <label class="check" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-inv ${x.inversion ? 'checked' : ''}> Inversión (costo de una vez)</label>
      <div class="acciones"><button class="primario chico" data-confirmar>Confirmar clasificación</button></div>
    </div>`).join('')}</div>`;
}

/** Gastos cargados como "Crédito": si en realidad eran compras en cuenta corriente, se pasan a la cuenta del proveedor. */
function htmlCredito() {
  if (!credito.length) return '';
  return `<div class="card"><h2>💳 ${credito.length} ${credito.length === 1 ? 'gasto cargado' : 'gastos cargados'} como "Crédito"</h2>
    <p class="vacio" style="margin-top:0">Si fue con tarjeta de crédito, dejalo como está. Si fue una compra en cuenta corriente, tocá "Era cuenta corriente": sale de la planilla de costos (se carga cuando se pague) y pasa a la deuda con ese proveedor.</p>
    ${credito.map(x => `<div class="pend" data-credito="${esc(x.id)}">
      <div class="meta">${esc(x.finca)} · ${fechaCorta(x.fecha)} · ${esc(x.categoria)}</div>
      <div><b>${esc(x.detalle)}</b> · ${peso(x.monto)}</div>
      <input class="campo" data-prov value="${esc(x.proveedor || '')}" placeholder="Proveedor (obligatorio)">
      <div class="acciones"><button class="primario chico" data-cc>↪️ Era cuenta corriente</button><button class="secundario chico" data-tarjeta>💳 Fue con tarjeta</button></div>
    </div>`).join('')}</div>`;
}

function pintarValidar() {
  const el = $('validar');
  if (!pendientes.length && !dudas.length && !credito.length) { el.innerHTML = '<div class="card"><p>✅ No hay nada pendiente de validar ni de clasificar.</p></div>'; return; }
  el.innerHTML = htmlCredito() + htmlDudas() + (!pendientes.length ? '' : `<div class="card"><h2>${pendientes.length} pendientes de validar</h2>
    <p class="vacio" style="margin-top:0">Rechazar un gasto lo saca de la planilla de la finca. Si te equivocás, lo cambiás en la hoja LOG de la base.</p>
    ${pendientes.map(p => `<div class="pend" data-id="${esc(p.id)}">
      <div class="meta">${esc(p.tipo)} · ${esc(p.registrado)} · ${esc(p.usuario)}${p.confianza !== '' && Number(p.confianza) < 0.75 ? ' · <b style="color:var(--alerta)">confianza ' + Math.round(p.confianza * 100) + '%</b>' : ''}</div>
      <div>${esc(p.resumen)}</div>
      ${p.entrada ? `<div class="entrada">“${esc(p.entrada)}”</div>` : ''}
      ${p.corregido ? `<div class="meta">✏️ Corregido: ${esc(p.corregido)}</div>` : ''}
      ${p.comprobante ? `<a class="meta" href="${esc(p.comprobante)}" target="_blank" rel="noopener">Ver comprobante ↗</a>` : ''}
      <div class="acciones"><button class="primario chico" data-estado="✅ Validado">✅ Validar</button>${p.datos ? '<button class="secundario chico" data-editar>✏️ Editar</button>' : ''}<button class="secundario chico" data-estado="❌ Rechazado">❌ Rechazar</button></div>
    </div>`).join('')}
    <button class="secundario" id="validar-todos" style="width:100%;margin-top:12px">✅ Validar todos (${pendientes.length})</button></div>`);

  el.querySelectorAll('[data-duda]').forEach(div => div.querySelector('[data-confirmar]').onclick = async () => {
    const b = div.querySelector('[data-confirmar]');
    b.disabled = true;
    try {
      await api('reclasificar', { id: div.dataset.duda, categoria: div.querySelector('[data-cat]').value, inversion: div.querySelector('[data-inv]').checked });
      dudas = dudas.filter(x => x.id !== div.dataset.duda);
      pintarValidar();
    } catch (e) {
      alert(e.message);
      b.disabled = false;
    }
  });

  el.querySelectorAll('.pend').forEach(div => div.querySelectorAll('[data-estado]').forEach(b => b.onclick = async () => {
    const id = div.dataset.id, estado = b.dataset.estado;
    if (estado.startsWith('❌') && !confirm('¿Rechazar este registro? Si es un gasto, se borra de la planilla de la finca.')) return;
    div.querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      await api('cambiarEstado', { id, estado });
      pendientes = pendientes.filter(p => p.id !== id);
      pintarValidar();
    } catch (e) {
      alert(e.message);
      div.querySelectorAll('button').forEach(x => { x.disabled = false; });
    }
  }));
  el.querySelectorAll('[data-credito]').forEach(div => div.querySelector('[data-tarjeta]').onclick = async () => {
    try {
      await api('confirmarCredito', { id: div.dataset.credito });
      credito = credito.filter(x => x.id !== div.dataset.credito);
      pintarValidar();
    } catch (e) { alert(e instanceof ErrorRed ? 'Sin señal: probá de nuevo cuando haya.' : e.message); }
  });
  el.querySelectorAll('[data-credito]').forEach(div => div.querySelector('[data-cc]').onclick = async () => {
    const proveedor = div.querySelector('[data-prov]').value.trim();
    if (!proveedor) { alert('Escribí el proveedor.'); return; }
    if (!confirm(`¿Pasar este gasto a la cuenta corriente de ${proveedor}? Sale de la planilla de costos hasta que se pague.`)) return;
    const b = div.querySelector('[data-cc]');
    b.disabled = true;
    try {
      const r = await api('aCuentaCorriente', { id: div.dataset.credito, proveedor });
      credito = credito.filter(x => x.id !== div.dataset.credito);
      pendientes = pendientes.filter(x => x.id !== div.dataset.credito);
      pintarValidar();
      alert(r.mensaje);
    } catch (e) {
      alert(e instanceof ErrorRed ? 'Sin señal: probá de nuevo cuando haya.' : e.message);
      b.disabled = false;
    }
  });

  // Editar: abre la misma tarjeta que se usa al cargar, con los datos guardados; al guardar se corrige y queda validado.
  el.querySelectorAll('.pend').forEach(div => {
    const b = div.querySelector('[data-editar]');
    if (!b) return;
    b.onclick = () => {
      const p = pendientes.find(x => x.id === div.dataset.id);
      const item = { id: 'ed-' + p.id, tipo: 'tarjeta', estado: 'editando', registro: Object.assign({}, p.datos), original: null };
      item.alCancelar = () => pintarValidar();
      item.alGuardar = async it => {
        document.querySelectorAll(`[data-item="${it.id}"] button`).forEach(x => { x.disabled = true; });
        try {
          await api('editar', { id: p.id, registro: it.registro });
          pendientes = pendientes.filter(x => x.id !== p.id);
          pintarValidar();
        } catch (e) {
          it.error = e instanceof ErrorRed ? 'Sin señal: probá de nuevo cuando haya.' : e.message;
          pintar(it);
        }
      };
      div.querySelector('.acciones').hidden = true;
      const t = document.createElement('div');
      t.className = 'tarjeta';
      t.dataset.item = item.id;
      t.innerHTML = htmlTarjeta(item);
      div.appendChild(t);
      conectarTarjeta(t, item);
    };
  });
  if ($('validar-todos')) $('validar-todos').onclick = async () => {
    if (!confirm(`¿Validar los ${pendientes.length} registros?`)) return;
    $('validar-todos').disabled = true;
    for (const p of [...pendientes]) {
      try { await api('cambiarEstado', { id: p.id, estado: '✅ Validado' }); pendientes = pendientes.filter(x => x.id !== p.id); }
      catch (e) { alert(e.message); break; }
    }
    pintarValidar();
  };
}

// ───────────────────────── Ayuda ─────────────────────────

function abrirAyuda() {
  const ej = t => `<div class="ejemplo">${esc(t)}</div>`;
  $('ayuda').innerHTML = `<div class="card">
    <h3>Cómo cargar algo</h3>
    <ol>
      <li>Abrí <b>Cargar</b> (abajo a la izquierda).</li>
      <li>Escribí, o tocá el <b>micrófono del teclado</b> y hablá, como si mandaras un WhatsApp.</li>
      <li>Tocá la <b>flecha verde</b>. Aparece una tarjeta con lo que entendí.</li>
      <li>Revisala. Si algo está mal, tocá el dato y corregilo.</li>
      <li>Tocá <b>Guardar</b>. Listo ✅</li>
    </ol>
    <p>Para mandar la foto de un ticket, factura o remito, tocá la <b>cámara</b>.</p>

    <h3>Ejemplos</h3>
    ${ej('Le pagué 150 mil a Pedro en efectivo')}
    ${ej('Gasoil para el tractor 85 mil, transferencia')}
    ${ej('Gasoil 100 mil, 60 para Angaco y 40 para Albardón')}
    ${ej('Pagamos a Agrícola del Oeste con cheque 1234 por 500 mil, se cobra el 15 de noviembre')}
    ${ej('Sacamos repuestos en cuenta corriente en la ferretería por 80 mil')}
    ${ej('Llegaron 40 bolsas de Aqua Phos de Agrícola del Oeste')}
    ${ej('Hoy en el cuadro 2 inyectamos 160 litros de Guenta')}
    ${ej('Jorge esta semana 3 días en Angaco y 2 en Albardón')}
    ${ej('A Leo le pagué 6 días')}
    ${ej('Pagué las cargas sociales de Jorge de octubre, 400 mil')}
    ${ej('Sergio mandó 1.200.000')}
    ${ej('Al 130 le cambiamos el aceite y el filtro, tiene 4.520 horas. El aceite salió 85 mil')}
    ${ej('¿Cuándo le hicimos el último cambio de aceite al 130?')}
    ${ej('Recordame pagar los intereses del préstamo, 350 mil, el 10 de cada mes')}
    ${ej('Recibí cheque de Bodega X, Banco Nación nº 5678, 1.200.000, se cobra el 20/11')}

    <h3>Agenda: cheques, impuestos, transferencias</h3>
    <p>En <b>Panel → Agenda</b> está todo lo que hay que hacer, ordenado por fecha. Cuando cobres o cubras un cheque, pagues un impuesto o hagas una transferencia, tocá <b>✓</b>. Se marca para Tato también. Si lo marcaste por error, en "Hechos" tocá <b>↩︎</b>.</p>

    <h3>Si me equivoqué</h3>
    <p>Después de guardar tenés <b>1 hora</b> para tocar <b>Deshacer</b>. Después de eso, avisale a Tato.</p>

    <h3>Si no hay señal</h3>
    <p>Mandá igual. El mensaje queda con un 🕓 y se envía solo cuando vuelve la señal. <b>No lo mandes dos veces.</b> Arriba aparece un aviso amarillo mientras haya cosas sin enviar.</p>

    <h3>Ver números</h3>
    <p>En <b>Panel</b> están los gastos, cuánto fertilizante se aplicó y cuánto falta, el stock y lo que falta que entreguen los proveedores.</p>

    <h3>¿Otra duda?</h3>
    <p>Preguntale al chat, por ejemplo: <i>"¿cómo cargo un cheque?"</i> o <i>"¿cuánta Guenta nos queda?"</i>.</p>

    <h3>Instalar en el iPhone</h3>
    <ol>
      <li>Abrí el link que te pasó Tato <b>en Safari</b>.</li>
      <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha para arriba).</li>
      <li>Elegí <b>Agregar a pantalla de inicio</b> → <b>Agregar</b>.</li>
      <li>Desde ahora abrila con el ícono verde de la pantalla.</li>
    </ol>
  </div>`;
}
