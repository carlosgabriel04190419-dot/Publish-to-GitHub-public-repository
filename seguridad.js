// ==========================================
// seguridad.js — Módulo compartido de sesión y datos del usuario
// CarzaD'Cross
//
// CÓMO USARLO en cada página:
// 1. Incluir en el <head> o antes de tu <script> propio, en este orden:
//      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//      <script src="seguridad.js"></script>
//      <script> ...tu código de la página... </script>
// 2. Ya NO declares tú mismo supabaseUrl/supabaseKey/supabaseClient en la página —
//    este archivo ya los crea. Si tu página los redeclara, dará un error de
//    "ya declarado". Bórralos de tu <script> propio.
// 3. Al inicio de tu window.onload, en vez de leer localStorage directamente, usa:
//
//      const usuario = await verificarSesion();
//      if (!usuario) return; // ya te mandó a login.html si hacía falta
//
//    "usuario" trae: nickname, correo, saldo, puntos, celular, id — siempre
//    verificado contra tu sesión REAL de Supabase Auth, nunca inventado.
//
// 4. Para páginas públicas (como index.html) donde NO es obligatorio haber
//    iniciado sesión, usa: const usuario = await verificarSesion(false);
//    Ahí "usuario" será null si nadie inició sesión, sin redirigir a nadie.
//
// 5. Para el botón de "Cerrar sesión", usa cerrarSesionSegura() en vez de
//    cerrarSesionLocal() — esa sí cierra la sesión de verdad en Supabase,
//    no solo borra el dato local.
// ==========================================

const supabaseUrl = 'https://kskynakwlglwmliffcnx.supabase.co';
const supabaseKey = 'sb_publishable_piAkvgxqryyzBfvbeIvTNw_MD_U4OjF';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Escapa texto antes de insertarlo con innerHTML — usar siempre que se muestre un
// nickname, paquete u otro dato que un usuario haya podido escribir (ej. el ticker
// de compras en vivo), para que no se pueda inyectar HTML/JS con un nickname malicioso.
function escHtml(v) { return (v === null || v === undefined) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * Verifica la sesión REAL de Supabase Auth (no localStorage) y trae los datos
 * actuales del usuario directo de la base de datos. Sincroniza localStorage
 * como caché de solo lectura para textos rápidos (ej. mensajes de WhatsApp),
 * pero nunca como fuente de verdad de quién eres.
 *
 * @param {boolean} requerido - true (por defecto): si no hay sesión válida,
 *   redirige a login.html. false: si no hay sesión, simplemente devuelve null
 *   sin redirigir (para páginas públicas como index.html).
 * @returns {Promise<object|null>} el usuario verificado o null.
 */
async function verificarSesion(requerido = true) {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        localStorage.removeItem('nombreUsuario');
        if (requerido) window.location.href = 'login.html';
        return null;
    }

    const { data: usuario, error } = await supabaseClient
        .from('usuarios')
        .select('*')
        .eq('correo', session.user.email)
        .single();

    if (error || !usuario) {
        // Sesión válida en Auth pero sin perfil correspondiente en "usuarios" (caso raro/roto)
        await supabaseClient.auth.signOut();
        localStorage.removeItem('nombreUsuario');
        if (requerido) window.location.href = 'login.html';
        return null;
    }

    localStorage.setItem('nombreUsuario', usuario.nickname);
    actualizarSaldoConvertido(usuario);
    convertirPreciosCatalogo(usuario);
    mostrarSaldoCodestoreSiEsAdmin();
    mostrarSaldoRevendedorEnNav(usuario);
    inicializarOcultarSaldoNav();
    return usuario;
}

/**
 * Si la cuenta es revendedor, hace que el chip de SALDO del menú (arriba a la
 * derecha) muestre su saldo en dólares (saldo_usd) en vez de soles — en TODAS
 * las páginas, no solo en el catálogo regular. Se aplica con un timeout de 0ms
 * a propósito: cada página fija su propio "#saldo-nav" en soles dentro de su
 * window.onload justo DESPUÉS de que verificarSesion() resuelve, así que si
 * escribiéramos el valor aquí mismo quedaría sobrescrito de inmediato. Un
 * setTimeout(0) encola esta corrección para la siguiente vuelta del event loop,
 * es decir después de que el script propio de la página termine de correr.
 */
function mostrarSaldoRevendedorEnNav(usuario) {
    if (!usuario || usuario.rol_cliente !== 'revendedor') return;
    setTimeout(() => {
        const label = document.getElementById('saldo-nav-label');
        const simbolo = document.getElementById('saldo-nav-simbolo');
        const monto = document.getElementById('saldo-nav');
        if (label) label.innerText = 'SALDO USD';
        if (simbolo) simbolo.innerText = '$ ';
        if (monto) monto.innerText = Number(usuario.saldo_usd || 0).toFixed(2);
    }, 0);
}

// Chip "CODESTORE $XXX" en el menú superior — solo se muestra si el correo logueado
// es de un administrador (el RPC ya trae ese chequeo incorporado, así que para un
// cliente normal esto no hace nada visible).
async function mostrarSaldoCodestoreSiEsAdmin() {
    const pill = document.getElementById('pill-saldo-codestore');
    if (!pill) return;
    const { data, error } = await supabaseClient.rpc('admin_ver_saldo_codestore');
    if (error || !data || data.error) return;
    document.getElementById('codestore-saldo-nav').innerText = '$' + Number(data.saldo).toFixed(2);
    pill.style.display = 'flex';
}

// ==========================================
// OCULTAR SALDO EN EL NAVBAR (para grabar pantalla sin mostrar montos
// reales ni revelar que se usa CodeStore como proveedor)
// ==========================================
// Se guarda en localStorage para que quede oculto al navegar entre páginas
// mientras se está grabando. Nunca se toca el valor real en la base de
// datos — solo se enmascara visualmente el texto ya mostrado en el chip.
const CLAVE_OCULTAR_SALDO = 'carza_ocultar_saldo';
const IDS_SALDO_OCULTABLES = ['saldo-nav', 'codestore-saldo-nav'];
let aplicandoMascaraSaldo = false; // evita que nuestra propia escritura dispare el observer en bucle

function saldoOcultoActivo() {
    return localStorage.getItem(CLAVE_OCULTAR_SALDO) === '1';
}

function enmascararElemento(el) {
    if (!el || el.textContent === '****') return;
    el.dataset.valorReal = el.textContent;
    aplicandoMascaraSaldo = true;
    el.textContent = '****';
    aplicandoMascaraSaldo = false;
}

function revelarElemento(el) {
    if (!el || el.dataset.valorReal === undefined) return;
    aplicandoMascaraSaldo = true;
    el.textContent = el.dataset.valorReal;
    aplicandoMascaraSaldo = false;
}

function aplicarVisibilidadExtraSaldo(activo) {
    // El símbolo de moneda, la línea de conversión y el chip completo de
    // CodeStore (icono + la palabra "CODESTORE" incluida) se ocultan del
    // todo — no basta con tapar el número, tampoco debe leerse el nombre.
    const simbolo = document.getElementById('saldo-nav-simbolo');
    const alt = document.getElementById('saldo-nav-alt');
    const pillCodestore = document.getElementById('pill-saldo-codestore');
    [ [simbolo, false], [alt, false] ].forEach(([el, _]) => {
        if (!el) return;
        if (activo) { if (el.dataset.displayReal === undefined) el.dataset.displayReal = el.style.display; el.style.display = 'none'; }
        else if (el.dataset.displayReal !== undefined) { el.style.display = el.dataset.displayReal; delete el.dataset.displayReal; }
    });
    if (pillCodestore) {
        if (activo) {
            if (pillCodestore.dataset.displayReal === undefined) pillCodestore.dataset.displayReal = pillCodestore.style.display;
            pillCodestore.style.display = 'none';
        } else if (pillCodestore.dataset.displayReal !== undefined) {
            pillCodestore.style.display = pillCodestore.dataset.displayReal;
            delete pillCodestore.dataset.displayReal;
        }
    }
}

function actualizarIconoOcultarSaldo(activo) {
    const btn = document.getElementById('btn-ocultar-saldo');
    if (!btn) return;
    const icono = btn.querySelector('.material-icons');
    if (icono) icono.innerText = activo ? 'visibility_off' : 'visibility';
    btn.title = activo ? 'Mostrar saldo' : 'Ocultar saldo (para grabar)';
}

function toggleOcultarSaldoNav() {
    const activo = !saldoOcultoActivo();
    localStorage.setItem(CLAVE_OCULTAR_SALDO, activo ? '1' : '0');
    IDS_SALDO_OCULTABLES.forEach(id => {
        const el = document.getElementById(id);
        if (activo) enmascararElemento(el); else revelarElemento(el);
    });
    aplicarVisibilidadExtraSaldo(activo);
    actualizarIconoOcultarSaldo(activo);
}

function inicializarOcultarSaldoNav() {
    const contenedor = document.getElementById('nav-logged-in');
    if (!contenedor) return;

    if (!document.getElementById('btn-ocultar-saldo')) {
        const btn = document.createElement('button');
        btn.id = 'btn-ocultar-saldo';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Ocultar saldo');
        btn.style.cssText = 'display:flex; align-items:center; justify-content:center; width:34px; height:34px; margin-left:6px; border-radius:50%; border:1px solid #41414d; background:#1e1e24; color:#a8a8b3; cursor:pointer; flex-shrink:0; padding:0;';
        btn.innerHTML = '<span class="material-icons" style="font-size:18px;">visibility</span>';
        btn.onclick = toggleOcultarSaldoNav;

        const dropdown = contenedor.querySelector('.user-dropdown-container');
        if (dropdown) dropdown.parentNode.insertBefore(btn, dropdown);
        else contenedor.appendChild(btn);

        // Re-aplica la máscara automáticamente si el saldo cambia mientras el
        // modo oculto está activo (ej. el chip de CodeStore llega por RPC async
        // después de que ya inicializamos, o el saldo de revendedor se corrige
        // con el setTimeout(0) de mostrarSaldoRevendedorEnNav).
        IDS_SALDO_OCULTABLES.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            new MutationObserver(() => {
                if (aplicandoMascaraSaldo || !saldoOcultoActivo()) return;
                enmascararElemento(el);
            }).observe(el, { characterData: true, childList: true, subtree: true });
        });
    }

    const activo = saldoOcultoActivo();
    if (activo) {
        IDS_SALDO_OCULTABLES.forEach(id => enmascararElemento(document.getElementById(id)));
    }
    aplicarVisibilidadExtraSaldo(activo);
    actualizarIconoOcultarSaldo(activo);
}

// ==========================================
// CONVERSIÓN DE SALDO A LA MONEDA DEL PAÍS DEL USUARIO
// ==========================================
// Todo el saldo se guarda siempre en soles (PEN) — esto es solo para MOSTRAR
// una referencia aproximada en la moneda local, usando el código de país que
// el usuario ya eligió en su número de WhatsApp al registrarse.

const MONEDA_POR_PREFIJO = [
    { prefijo: '591', moneda: 'BOB' }, // Bolivia (va antes que "51" para no chocar con Perú)
    { prefijo: '593', moneda: 'USD' }, // Ecuador usa dólar
    { prefijo: '595', moneda: 'PYG' }, // Paraguay
    { prefijo: '598', moneda: 'UYU' }, // Uruguay
    { prefijo: '507', moneda: 'USD' }, // Panamá usa dólar
    { prefijo: '51', moneda: 'PEN' },  // Perú
    { prefijo: '52', moneda: 'MXN' },  // México
    { prefijo: '54', moneda: 'ARS' },  // Argentina
    { prefijo: '55', moneda: 'BRL' },  // Brasil
    { prefijo: '56', moneda: 'CLP' },  // Chile
    { prefijo: '57', moneda: 'COP' },  // Colombia
    { prefijo: '58', moneda: 'USD' },  // Venezuela (bolívar muy inestable, mostramos USD)
    { prefijo: '34', moneda: 'EUR' },  // España
    { prefijo: '1', moneda: 'USD' },   // EE. UU. / Canadá
];

function monedaSegunCelular(celular) {
    if (!celular) return null;
    const limpio = celular.replace(/\D/g, '');
    const encontrado = MONEDA_POR_PREFIJO.find(m => limpio.startsWith(m.prefijo));
    return encontrado ? encontrado.moneda : null;
}

const SIMBOLO_MONEDA = { USD: '$', EUR: '€', PEN: 'S/', MXN: '$', ARS: '$', CLP: '$', COP: '$', UYU: '$', BRL: 'R$', BOB: 'Bs', PYG: '₲' };

async function obtenerTasasCambio() {
    const CACHE_KEY = 'tasasCambioPEN';
    const CACHE_HORAS = 12;
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cache && (Date.now() - cache.guardadoEn) < CACHE_HORAS * 60 * 60 * 1000) {
            return cache.rates;
        }
        const resp = await fetch('https://open.er-api.com/v6/latest/PEN');
        const datos = await resp.json();
        if (datos.result !== 'success') return cache ? cache.rates : null;
        localStorage.setItem(CACHE_KEY, JSON.stringify({ rates: datos.rates, guardadoEn: Date.now() }));
        return datos.rates;
    } catch (e) {
        console.error('No se pudo obtener el tipo de cambio:', e);
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        return cache ? cache.rates : null;
    }
}

/** Convierte un monto en soles a la moneda indicada y lo devuelve ya formateado, ej: "≈ $ 515,48 MXN". */
function formatearMontoConvertido(montoPEN, moneda, tasas) {
    const montoConvertido = montoPEN * tasas[moneda];
    const simbolo = SIMBOLO_MONEDA[moneda] || '';
    // ARS, CLP, COP y PYG no se usan con centavos en la vida diaria: se redondean a entero.
    const sinDecimales = ['ARS', 'CLP', 'COP', 'PYG'].includes(moneda);
    const montoFormateado = montoConvertido.toLocaleString('es', {
        minimumFractionDigits: sinDecimales ? 0 : 2,
        maximumFractionDigits: sinDecimales ? 0 : 2,
    });
    return `≈ ${simbolo} ${montoFormateado} ${moneda}`;
}

/** Devuelve la moneda del usuario y las tasas de cambio, o null si es de Perú / no hay datos. */
async function prepararConversion(usuario) {
    const moneda = monedaSegunCelular(usuario.celular);
    if (!moneda || moneda === 'PEN') return null;

    const tasas = await obtenerTasasCambio();
    if (!tasas || !tasas[moneda]) return null;

    return { moneda, tasas };
}

/** Si la página tiene un elemento #saldo-nav-alt, lo llena con el saldo convertido a la moneda del usuario. */
async function actualizarSaldoConvertido(usuario) {
    await actualizarElementoConversion('saldo-nav-alt', usuario.saldo, usuario);
}

/**
 * Llena cualquier elemento (identificado por su id) con la conversión de un monto en
 * soles a la moneda del usuario, ej. para usarlo en el modal de compra ("Costo a
 * descontar", "Saldo Restante", etc). Lo oculta si el usuario es de Perú o no se pudo
 * calcular la conversión.
 */
async function actualizarElementoConversion(idElemento, montoPEN, usuario) {
    const elemento = document.getElementById(idElemento);
    if (!elemento || !usuario) return;

    const conversion = await prepararConversion(usuario);
    if (!conversion) { elemento.style.display = 'none'; return; }

    elemento.innerText = formatearMontoConvertido(montoPEN, conversion.moneda, conversion.tasas);
    elemento.style.display = 'block';
}

/** Agrega debajo de cada precio de producto (.card-prices) su equivalente en la moneda del usuario. */
async function convertirPreciosCatalogo(usuario) {
    const tarjetasPrecio = document.querySelectorAll('.card-prices');
    if (tarjetasPrecio.length === 0) return;

    const conversion = await prepararConversion(usuario);
    if (!conversion) return;

    tarjetasPrecio.forEach(contenedor => {
        if (contenedor.dataset.conversionAgregada) return;

        const precioActual = contenedor.querySelector('.price-current');
        if (!precioActual) return;

        const soles = parseFloat(precioActual.innerText.replace(/[^\d.]/g, ''));
        if (isNaN(soles)) return;

        const linea = document.createElement('div');
        linea.className = 'price-alt';
        linea.style.cssText = 'font-size:11px; color:#8a8a9a; font-weight:600; text-align:center; margin-top:-14px; margin-bottom:16px;';
        linea.innerText = formatearMontoConvertido(soles, conversion.moneda, conversion.tasas);

        contenedor.insertAdjacentElement('afterend', linea);
        contenedor.dataset.conversionAgregada = '1';
    });
}

/**
 * Aplica imágenes de portada configurables desde el admin (tabla portadas_catalogo).
 * @param {Object} mapa - { idDeElemento: { slug, plantilla? } }. `plantilla` es opcional,
 * usa {url} como marcador si el fondo necesita algo más que un url() simple (ej. un degradado).
 */
async function aplicarPortadas(mapa) {
    const slugs = Object.values(mapa).map(cfg => cfg.slug);
    const { data } = await supabaseClient.from('portadas_catalogo').select('slug, imagen_url').in('slug', slugs);
    if (!data) return;
    const porSlug = {};
    data.forEach(r => { porSlug[r.slug] = r.imagen_url; });
    Object.entries(mapa).forEach(([elementId, cfg]) => {
        const url = porSlug[cfg.slug];
        const el = document.getElementById(elementId);
        if (!el || !url) return;
        el.style.background = cfg.plantilla ? cfg.plantilla.replace('{url}', url) : `url('${url}') center/cover no-repeat`;
    });
}

/** Cierra sesión de verdad (invalida la sesión en Supabase) y limpia el caché local. */
async function cerrarSesionSegura() {
    await supabaseClient.auth.signOut();
    localStorage.removeItem('nombreUsuario');
    window.location.href = 'login.html';
}

/**
 * Devuelve el HTML del mini-avatar + nickname + flechita para el botón de
 * usuario de la barra de navegación (btn-usuario-nav). Usa la foto de perfil
 * si el usuario tiene una, o un círculo con su inicial si no.
 */
function avatarPillHTML(usuario) {
    const inicial = usuario.nickname.charAt(0).toUpperCase();
    const foto = usuario.avatar_url
        ? `<img src="${usuario.avatar_url}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;border:1px solid rgba(255,255,255,0.4);">`
        : `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,0.25);color:white;font-size:12px;font-weight:bold;vertical-align:middle;">${inicial}</span>`;
    return `${foto} <span style="vertical-align:middle;">${usuario.nickname}</span> <span class="material-icons" style="font-size: 18px; vertical-align:middle;">expand_more</span>`;
}

// ==========================================
// VALIDACIÓN DE ID DE FREE FIRE (nickname real del jugador)
// ==========================================
// API gratuita de terceros (no oficial de Garena), usada solo para confirmar
// el nickname real detrás de un ID antes de procesar una recarga.
const FF_API_BASE = 'https://siambhau69.eu.cc/freefireinfo/bhau';
const FF_API_KEY = 'FFINFO-Free69';
const FF_API_REGION = 'SAC'; // Sudamérica: cubre Perú y el resto de países que atiende la tienda
const FF_BANNER_API_BASE = 'https://siambhau69.eu.cc/banner/profile';
const FF_BANNER_API_KEY = 'BANNER-Free69';

/**
 * URL de la imagen de banner (avatar, escudo del clan y nivel) de una cuenta de Free Fire.
 */
function urlBannerFreeFire(uid) {
    return `${FF_BANNER_API_BASE}?uid=${encodeURIComponent(uid)}&region=${FF_API_REGION}&key=${FF_BANNER_API_KEY}`;
}

/**
 * Consulta el nickname real de una cuenta de Free Fire a partir de su UID.
 * @returns {Promise<{ok: true, nickname: string, nivel: number} | {ok: false, error: string}>}
 */
async function validarUidFreeFire(uid) {
    try {
        const url = `${FF_API_BASE}?uid=${encodeURIComponent(uid)}&region=${FF_API_REGION}&key=${FF_API_KEY}`;
        const resp = await fetch(url);
        const datos = await resp.json();

        // La API a veces responde 200/503 con un cuerpo tipo {"error":"maintenance",...}
        // en vez de fallar la petición — hay que detectarlo antes de asumir "cuenta no encontrada",
        // para no darle a entender al cliente que su ID está mal cuando el problema es del bot.
        if (!resp.ok || (datos && datos.error)) {
            return { ok: false, error: 'El bot de reconocimiento de nickname está en mantenimiento.' };
        }

        if (!datos || !datos.basicInfo || !datos.basicInfo.nickname) {
            return { ok: false, error: 'No se encontró ninguna cuenta con ese ID.' };
        }

        return { ok: true, nickname: datos.basicInfo.nickname, nivel: datos.basicInfo.level };
    } catch (e) {
        console.error('Error validando UID de Free Fire:', e);
        return { ok: false, error: 'El bot de reconocimiento de nickname está en mantenimiento.' };
    }
}

// ==========================================
// BLOQUEO DE SCROLL DE FONDO CON MODALES ABIERTOS
// ==========================================
// Evita que la página de atrás se desplace junto con la ventana modal abierta.
// Se fija sola en cualquier modal que exista en la página (no hace falta tocar
// las funciones que ya abren/cierran cada modal).
(function inicializarBloqueoScrollModales() {
    const idsModales = [
        'custom-modal-overlay', 'modal-buscar-usuario-overlay', 'modal-galeria-cuenta-overlay',
        'modal-editar-cuenta-overlay', 'modal-completar-cuenta-overlay', 'modal-asignar-perfil-overlay',
        'modal-editar-cuenta-madre-overlay', 'modal-editar-cliente-overlay', 'user-history-modal',
        'modal-compra-container', 'modal-compra-cuenta-container', 'modal-renovar-container',
        'modal-exito-recarga', 'modal-whatsapp-grupo', 'modal-canje-lightbox'
    ];

    function actualizarBloqueoScroll() {
        const hayModalAbierto = idsModales.some(id => {
            const el = document.getElementById(id);
            return el && getComputedStyle(el).display !== 'none';
        });
        document.documentElement.style.overflow = hayModalAbierto ? 'hidden' : '';
    }

    const observador = new MutationObserver(actualizarBloqueoScroll);
    idsModales.forEach(id => {
        const el = document.getElementById(id);
        if (el) observador.observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    actualizarBloqueoScroll();
})();
