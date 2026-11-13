import PrebillApiClient from '../core/PrebillApiClient.js';

// Configuración del despacho en ReportesSandbox: /config-despacho (factura, respaldo, responsables,
// CFDI y membrete), conceptos de factura y catálogos (niveles, tareas estándar, categorías de gasto).
// NO escribe en Books: vincular un concepto solo guarda el item_id de un artículo que ya existe, y
// "conceptos faltantes" llama a crear-en-books SIN confirmar (solo lista, no crea).
export class DespachoError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

const orgId = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const idParam = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e7 && Math.round(value * 100) === value * 100;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const utbms = value => typeof value === 'string' && /^[A-Za-z0-9]{0,10}$/.test(value);
const flag = value => value === 0 || value === 1;

const unexpected = what => Object.assign(new DespachoError(`El servicio de Aptus devolvió ${what} con formato inesperado.`, 502), { stage: 'response', outcome_unknown: true });
const needObject = body => { if (!isObject(body)) throw new DespachoError('Se requiere un objeto JSON.'); };

// ── /config-despacho ─────────────────────────────────────────────────────────
// Secciones y llaves que se reenvían; ReportesSandbox valida los valores y responde 400 con el motivo.
const CONFIG_KEYS = {
    factura: ['modo', 'lineas_detalladas'],
    respaldo: ['exigir_usuario_books', 'usuario_books_omision'],
    responsables: ['facturacion', 'cobranza', 'rol_wip'],
    cfdi: ['proveedor', 'solo_pagadas', 'creator'],
    formatos: ['despacho', 'datos_bancarios', 'ciudad_emision', 'firma', 'nota_pie', 'prebill_formato', 'campo_razon_social', 'campo_rfc'],
};
export const SECCIONES = Object.keys(CONFIG_KEYS);
const FUENTES = ['campo_cliente', 'rol_proyecto', 'local'];

function validateFuentes(rol, value) {
    if (!isObject(value) || !Array.isArray(value.fuentes) || Object.keys(value).length !== 1) throw new DespachoError(`responsables.${rol} debe ser { fuentes: [...] }.`);
    const { fuentes } = value;
    if (fuentes.length < 1 || fuentes.length > 5) throw new DespachoError(`responsables.${rol}: entre 1 y 5 fuentes.`);
    return {
        fuentes: fuentes.map((f, i) => {
            if (!isObject(f) || !FUENTES.includes(f.tipo)) throw new DespachoError(`responsables.${rol}: la fuente ${i + 1} tiene un tipo inválido.`);
            if (f.tipo === 'campo_cliente') {
                if (typeof f.campo !== 'string' || !/^cf_\w{1,80}$/.test(f.campo)) throw new DespachoError(`responsables.${rol}: el campo del cliente debe ser el api_name (cf_...).`);
                return { tipo: f.tipo, campo: f.campo };
            }
            if (f.tipo === 'rol_proyecto') {
                if (!text(f.rol, 80)) throw new DespachoError(`responsables.${rol}: falta el rol del proyecto en Books.`);
                return { tipo: f.tipo, rol: f.rol.trim() };
            }
            return { tipo: 'local' };
        }),
    };
}

export function validateConfigPatch(body) {
    needObject(body);
    if (JSON.stringify(body).length > 20000) throw new DespachoError('La configuración es demasiado grande.');
    const payload = {};
    for (const [section, value] of Object.entries(body)) {
        if (!CONFIG_KEYS[section]) throw new DespachoError(`Sección desconocida: ${section}.`);
        if (!isObject(value) || !Object.keys(value).length) throw new DespachoError(`${section} debe ser un objeto con cambios.`);
        const out = {};
        for (const [key, v] of Object.entries(value)) {
            if (!CONFIG_KEYS[section].includes(key)) throw new DespachoError(`Campo desconocido: ${section}.${key}.`);
            out[key] = section === 'responsables' && key !== 'rol_wip' ? validateFuentes(key, v) : v;
        }
        if (section === 'respaldo' && has(out, 'usuario_books_omision') && !(typeof out.usuario_books_omision === 'string' && /^\d{0,25}$/.test(out.usuario_books_omision))) {
            throw new DespachoError('usuario_books_omision debe ser el ID del usuario de Books (solo dígitos).');
        }
        payload[section] = out;
    }
    if (!Object.keys(payload).length) throw new DespachoError('No hay cambios que guardar.');
    return payload;
}

export function validateRestablecer(body) {
    needObject(body);
    if (body.seccion === undefined || body.seccion === '') return {};
    if (!SECCIONES.includes(body.seccion)) throw new DespachoError('seccion debe ser factura, respaldo, responsables, cfdi o formatos.');
    return { seccion: body.seccion };
}

// ── Conceptos de factura ─────────────────────────────────────────────────────
export const CONCEPTOS = ['honorarios', 'honorarios_fijos', 'gastos', 'reembolsos'];
export function validateConcepto(body) {
    needObject(body);
    const payload = {};
    for (const key of ['item_id_es', 'item_id_en']) {
        if (!has(body, key)) continue;
        if (typeof body[key] !== 'string' || !/^\d{1,25}$/.test(body[key])) throw new DespachoError(`${key} debe ser el ID de un artículo de Books.`);
        payload[key] = body[key];
    }
    if (!Object.keys(payload).length) throw new DespachoError('Indica el artículo en español o en inglés.');
    return payload;
}

// ── Catálogos ────────────────────────────────────────────────────────────────
function tarifasNivel(body, payload, { create }) {
    for (const m of ['mxn', 'usd', 'eur']) {
        const key = 'tarifa_' + m;
        if (!has(body, key)) continue;
        if (body[key] === null) { if (create) continue; payload[key] = ''; continue; } // vacía = la quita
        if (!money(body[key])) throw new DespachoError(`La tarifa en ${m.toUpperCase()} debe ser un número ≥ 0 con máximo 2 decimales.`);
        payload[key] = body[key];
    }
}

function nombre(body, payload, required) {
    if (!has(body, 'nombre')) { if (required) throw new DespachoError('El nombre es requerido.'); return; }
    if (!text(body.nombre, 120)) throw new DespachoError('El nombre debe tener entre 1 y 120 caracteres.');
    payload.nombre = body.nombre.trim();
}

function comunes(body, payload, { create }) {
    if (has(body, 'codigo_utbms')) {
        if (!utbms(body.codigo_utbms)) throw new DespachoError('El código UTBMS debe ser como L210 o E107 (o vacío).');
        payload.codigo_utbms = body.codigo_utbms.toUpperCase();
    }
    if (create) return;
    if (has(body, 'activo')) { if (typeof body.activo !== 'boolean') throw new DespachoError('activo debe ser booleano.'); payload.activo = body.activo ? 1 : 0; }
    if (has(body, 'orden')) { if (!Number.isInteger(body.orden) || body.orden < 0 || body.orden > 100000) throw new DespachoError('orden debe ser un entero ≥ 0.'); payload.orden = body.orden; }
}

export const CATALOGOS = {
    'tipos-abogado': {
        label: 'nivel',
        validate(body, create) {
            needObject(body);
            const payload = {};
            nombre(body, payload, create);
            tarifasNivel(body, payload, { create });
            if (create && !['tarifa_mxn', 'tarifa_usd', 'tarifa_eur'].some(k => has(payload, k))) throw new DespachoError('Indica al menos una tarifa por hora.');
            return payload;
        },
        // Borrar un nivel borra sus tarifas (ReportesSandbox responde 409 si un abogado lo usa).
        deletable: true,
    },
    'tareas-estandar': {
        label: 'tarea',
        validate(body, create) {
            needObject(body);
            const payload = {};
            nombre(body, payload, create);
            comunes(body, payload, { create });
            if (has(body, 'facturable')) { if (!flag(body.facturable)) throw new DespachoError('facturable debe ser 0 o 1.'); payload.facturable = body.facturable; }
            return payload;
        },
        deletable: false, // soft-delete: se desactiva con activo=false
    },
    'categorias-gasto': {
        label: 'categoría',
        validate(body, create) {
            needObject(body);
            const payload = {};
            nombre(body, payload, create);
            comunes(body, payload, { create });
            if (has(body, 'tipo')) { if (!['gasto', 'reembolso'].includes(body.tipo)) throw new DespachoError('tipo debe ser gasto o reembolso.'); payload.tipo = body.tipo; }
            return payload;
        },
        deletable: false,
    },
};

export default class DespachoService {
    constructor(organizationId, { api = null, req = null } = {}) {
        if (!orgId(organizationId)) throw new DespachoError('Organización inválida.');
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    async config() {
        const data = await this.api.request('get', '/config-despacho', { stage: 'get_config' });
        if (!isObject(data?.config)) throw unexpected('la configuración');
        return data;
    }

    async updateConfig(body) {
        const payload = validateConfigPatch(body);
        // El usuario por omisión debe existir en Books (lista de solo lectura).
        const u = payload.respaldo?.usuario_books_omision;
        if (u) {
            const usuarios = await this.api.request('get', '/zoho/usuarios', { stage: 'usuarios_books' });
            if (!Array.isArray(usuarios) || !usuarios.some(x => String(x.zoho_id) === u)) throw new DespachoError('Ese usuario no existe en Books.', 422);
        }
        const data = await this.api.request('patch', '/config-despacho', { data: payload, stage: 'update_config' });
        if (!isObject(data?.config)) throw unexpected('la configuración');
        return data;
    }

    async restablecer(body) {
        const payload = validateRestablecer(body ?? {});
        const data = await this.api.request('post', '/config-despacho/restablecer', { data: payload, stage: 'restablecer_config' });
        if (!isObject(data)) throw unexpected('la configuración');
        return data;
    }

    async conceptos() {
        const data = await this.api.request('get', '/conceptos-factura', { stage: 'conceptos' });
        if (!Array.isArray(data)) throw unexpected('los conceptos');
        return data;
    }

    async articulos() {
        const data = await this.api.request('get', '/zoho/articulos', { stage: 'articulos_books' });
        if (!Array.isArray(data)) throw unexpected('los artículos de Books');
        return data;
    }

    async updateConcepto(clave, body) {
        if (!CONCEPTOS.includes(clave)) throw new DespachoError('Concepto inválido.');
        const payload = validateConcepto(body);
        // Solo artículos que ya existen en Books; nunca se crea uno desde aquí.
        const articulos = await this.articulos();
        const ids = new Set(articulos.map(a => String(a.zoho_id ?? a.item_id)));
        for (const id of Object.values(payload)) if (!ids.has(id)) throw new DespachoError('Ese artículo no existe en Books.', 422);
        const data = await this.api.request('patch', '/conceptos-factura/' + clave, { data: payload, stage: 'update_concepto' });
        if (!isObject(data) && !Array.isArray(data)) throw unexpected('el concepto');
        return data;
    }

    // Sin confirmar=1: ReportesSandbox solo lista los artículos que faltan; no escribe en Books.
    async conceptosFaltantes() {
        const data = await this.api.request('post', '/conceptos-factura/crear-en-books', { data: {}, stage: 'conceptos_faltantes' });
        if (!isObject(data)) throw unexpected('los conceptos faltantes');
        return data;
    }

    catalogo(name) {
        const c = CATALOGOS[name];
        if (!c) throw new DespachoError('Catálogo inválido.', 404);
        return c;
    }

    async createItem(name, body) {
        const c = this.catalogo(name);
        const payload = c.validate(body, true);
        const data = await this.api.request('post', '/' + name, { data: payload, stage: 'create_' + name });
        if (!data || !Number.isInteger(data.id)) throw unexpected(`el ${c.label}`);
        return data;
    }

    async updateItem(name, id, body) {
        const c = this.catalogo(name);
        if (!idParam(id)) throw new DespachoError(`ID de ${c.label} inválido.`);
        const payload = c.validate(body, false);
        if (!Object.keys(payload).length) throw new DespachoError('No hay cambios que guardar.');
        const data = await this.api.request('patch', `/${name}/${id}`, { data: payload, stage: 'update_' + name });
        if (!data || !Number.isInteger(data.id)) throw unexpected(`el ${c.label}`);
        return data;
    }

    async deleteItem(name, id) {
        const c = this.catalogo(name);
        if (!c.deletable) throw new DespachoError(`Una ${c.label} no se borra: se desactiva.`, 404);
        if (!idParam(id)) throw new DespachoError(`ID de ${c.label} inválido.`);
        const data = await this.api.request('delete', `/${name}/${id}`, { stage: 'delete_' + name });
        return isObject(data) ? data : { ok: true };
    }
}
