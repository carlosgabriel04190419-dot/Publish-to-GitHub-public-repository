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
    return usuario;
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
const FF_API_KEY = 'FFINFO-Free';
const FF_API_REGION = 'SAC'; // Sudamérica: cubre Perú y el resto de países que atiende la tienda

/**
 * Consulta el nickname real de una cuenta de Free Fire a partir de su UID.
 * @returns {Promise<{ok: true, nickname: string, nivel: number} | {ok: false, error: string}>}
 */
async function validarUidFreeFire(uid) {
    try {
        const url = `${FF_API_BASE}?uid=${encodeURIComponent(uid)}&region=${FF_API_REGION}&key=${FF_API_KEY}`;
        const resp = await fetch(url);
        const datos = await resp.json();

        if (!datos || !datos.basicInfo || !datos.basicInfo.nickname) {
            return { ok: false, error: 'No se encontró ninguna cuenta con ese ID.' };
        }

        return { ok: true, nickname: datos.basicInfo.nickname, nivel: datos.basicInfo.level };
    } catch (e) {
        console.error('Error validando UID de Free Fire:', e);
        return { ok: false, error: 'No se pudo validar el ID en este momento. Puedes escribir tu nickname manualmente.' };
    }
}
