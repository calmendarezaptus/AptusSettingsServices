import PrebillApiClient from '../core/PrebillApiClient.js';

// Configuración de abogados en ReportesSandbox: nivel, activo, tarifa propia por moneda, enlace con
// su usuario de Books y si puede ser responsable. Todo por PATCH /abogados/:id.
// NO escribe en Books y no crea Usuarios de Books: el enlace solo guarda el user_id, y sincronizar
// solo lee del User de Books (foto, nombre, status, correo).
export class AbogadoConfigError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export const MONEDAS = ['MXN', 'USD', 'EUR'];
export const RESPONSABLES = ['facturacion', 'cobranza', 'general'];

const orgId = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const idParam = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const localId = value => Number.isInteger(value) && value > 0;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e7 && Math.round(value * 100) === value * 100;
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

// Solo estos campos; nombre, foto y correo no se editan desde aquí (salen del usuario de Books).
export function validateAbogadoPatch(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AbogadoConfigError('Se requiere un objeto JSON.');
    const payload = {};
    if (has(body, 'tipo_id')) {
        if (!localId(body.tipo_id)) throw new AbogadoConfigError('tipo_id debe ser el ID del nivel (entero).');
        payload.tipo_id = body.tipo_id;
    }
    if (has(body, 'activo')) {
        if (typeof body.activo !== 'boolean') throw new AbogadoConfigError('activo debe ser booleano.');
        payload.activo = body.activo ? 1 : 0;
    }
    if (has(body, 'tarifas_propias')) {
        const t = body.tarifas_propias;
        if (!t || typeof t !== 'object' || Array.isArray(t) || !Object.keys(t).length) throw new AbogadoConfigError('tarifas_propias debe ser un objeto { MXN, USD, EUR }.');
        for (const [moneda, value] of Object.entries(t)) {
            if (!MONEDAS.includes(moneda)) throw new AbogadoConfigError(`Moneda inválida en tarifas_propias: ${moneda}.`);
            if (value !== null && !money(value)) throw new AbogadoConfigError(`La tarifa propia en ${moneda} debe ser un número ≥ 0 con máximo 2 decimales, o vacía.`);
            // Vacía = quita la tarifa propia (vuelve a la de su nivel).
            payload['tarifa_propia_' + moneda.toLowerCase()] = value === null ? '' : value;
        }
    }
    if (has(body, 'zoho_user_id')) {
        if (typeof body.zoho_user_id !== 'string' || (body.zoho_user_id !== '' && !/^\d{1,25}$/.test(body.zoho_user_id))) throw new AbogadoConfigError('zoho_user_id debe ser el ID del usuario de Books, o vacío para desenlazar.');
        payload.zoho_user_id = body.zoho_user_id;
    }
    if (has(body, 'responsable')) {
        if (body.responsable !== null && !RESPONSABLES.includes(body.responsable)) throw new AbogadoConfigError('responsable debe ser facturacion, cobranza, general o null.');
        payload.responsable = body.responsable;
    }
    if (!Object.keys(payload).length) throw new AbogadoConfigError('No hay cambios que guardar.');
    return payload;
}

const unexpected = what => Object.assign(new AbogadoConfigError(`El servicio de Aptus devolvió ${what} con formato inesperado.`, 502), { stage: 'response', outcome_unknown: true });

export default class AbogadoConfigService {
    constructor(organizationId, { api = null, req = null } = {}) {
        if (!orgId(organizationId)) throw new AbogadoConfigError('Organización inválida.');
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    check(id) { if (!idParam(id)) throw new AbogadoConfigError('ID de abogado inválido.'); }

    async get(id) {
        this.check(id);
        const data = await this.api.request('get', '/abogados/' + id, { stage: 'get_abogado' });
        if (!data || !Number.isInteger(data.id)) throw unexpected('un abogado');
        return data;
    }

    async update(id, body) {
        this.check(id);
        const payload = validateAbogadoPatch(body);
        // Enlazar: el usuario debe existir en Books (lista de solo lectura). Nunca se crea uno.
        if (payload.zoho_user_id) {
            const usuarios = await this.usuariosBooks();
            if (!usuarios.some(u => String(u.zoho_id) === payload.zoho_user_id)) throw new AbogadoConfigError('Ese usuario no existe en Books.', 422);
        }
        const data = await this.api.request('patch', '/abogados/' + id, { data: payload, stage: 'update_abogado' });
        if (!data || !Number.isInteger(data.id)) throw unexpected('un abogado');
        return data;
    }

    // Refresca foto, nombre, status y correo desde el usuario de Books enlazado (lectura en Books).
    async sincronizar(id) {
        this.check(id);
        const data = await this.api.request('post', '/abogados/' + id + '/sincronizar-zoho', { stage: 'sincronizar_abogado' });
        if (!data || typeof data !== 'object') throw unexpected('el abogado');
        return data;
    }

    async usuariosBooks() {
        const data = await this.api.request('get', '/zoho/usuarios', { stage: 'usuarios_books' });
        if (!Array.isArray(data)) throw unexpected('los usuarios de Books');
        return data;
    }
}
