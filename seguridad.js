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
    return usuario;
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
