import PrebillApiClient from '../core/PrebillApiClient.js';

// Tarifas del despacho y de cada cliente, e IVA e idioma por cliente, en ReportesSandbox.
// NO escribe en Books (el IVA solo guarda el ID de un impuesto que ya existe en Books).
//
// Qué tarifas se tocan desde aquí (jerarquía de prebill-api.md, "Tarifas"):
//   general (9), cliente (6), cliente + nivel (5), cliente + abogado (4).
// Las demás tienen su propio lugar y aquí responden 403:
//   tarifa propia del abogado (7) → Configuración de abogados; tarifa del nivel (8) → Catálogos/Niveles;
//   cualquier tarifa de proyecto (1-3) → Configuración del proyecto.
export class TarifaError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export const MONEDAS = ['MXN', 'USD', 'EUR'];
export const NIVELES_EDITABLES = ['general', 'cliente', 'cliente_tipo', 'cliente_abogado'];
export const IDIOMAS = ['es', 'en'];

const orgId = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
const idParam = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const clienteId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
const localId = value => Number.isInteger(value) && value > 0;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e7 && Math.round(value * 100) === value * 100;
const present = value => value !== undefined && value !== null && value !== '';
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

const DONDE = {
    abogado: 'La tarifa propia del abogado se edita en Configuración de abogados.',
    tipo: 'La tarifa del nivel se edita en Configuración del despacho → Catálogos → Niveles.',
    proyecto: 'Las tarifas de un proyecto se editan en Configuración del proyecto.',
};

// Nivel de la jerarquía según los campos (mismo criterio que ReportesSandbox).
export function nivelDe({ proyecto_id, cliente_id, abogado_id, tipo_id }) {
    const quien = present(abogado_id) ? 'abogado' : present(tipo_id) ? 'tipo' : '';
    if (present(proyecto_id)) return quien ? `proyecto_${quien}` : 'proyecto';
    if (present(cliente_id)) return quien ? `cliente_${quien}` : 'cliente';
    return quien || 'general';
}

function noEditable(nivel) {
    const key = nivel.startsWith('proyecto') ? 'proyecto' : nivel;
    return new TarifaError(DONDE[key] ?? 'Esta tarifa no se edita desde aquí.', 403);
}

export function validateTarifa(body) {
    if (!isObject(body)) throw new TarifaError('Se requiere un objeto JSON.');
    if (present(body.proyecto_id)) throw noEditable('proyecto');
    if (!MONEDAS.includes(body.moneda)) throw new TarifaError('moneda debe ser MXN, USD o EUR.');
    if (!money(body.tarifa)) throw new TarifaError('tarifa debe ser un número ≥ 0 con máximo 2 decimales.');
    const payload = { moneda: body.moneda, tarifa: body.tarifa };
    if (present(body.cliente_id)) {
        if (!clienteId(body.cliente_id)) throw new TarifaError('cliente_id debe ser el ID del cliente en Books.');
        payload.cliente_id = body.cliente_id;
    }
    if (present(body.abogado_id) && present(body.tipo_id)) throw new TarifaError('Una tarifa es por abogado o por nivel, no ambos.');
    if (present(body.abogado_id)) { if (!localId(body.abogado_id)) throw new TarifaError('abogado_id debe ser un entero.'); payload.abogado_id = body.abogado_id; }
    if (present(body.tipo_id)) { if (!localId(body.tipo_id)) throw new TarifaError('tipo_id debe ser un entero.'); payload.tipo_id = body.tipo_id; }
    const nivel = nivelDe(payload);
    if (!NIVELES_EDITABLES.includes(nivel)) throw noEditable(nivel);
    return payload;
}

export function validateClienteConfig(body) {
    if (!isObject(body)) throw new TarifaError('Se requiere un objeto JSON.');
    const payload = {};
    if (body.zoho_tax_id !== undefined) {
        if (typeof body.zoho_tax_id !== 'string' || (body.zoho_tax_id !== '' && !/^\d{1,25}$/.test(body.zoho_tax_id))) throw new TarifaError('zoho_tax_id debe ser el ID del impuesto en Books, o vacío para quitarlo.');
        payload.zoho_tax_id = body.zoho_tax_id;
    }
    if (body.idioma !== undefined) {
        if (body.idioma !== '' && !IDIOMAS.includes(body.idioma)) throw new TarifaError('idioma debe ser es, en o vacío (el de Books).');
        payload.idioma = body.idioma;
    }
    if (!Object.keys(payload).length) throw new TarifaError('No hay cambios que guardar.');
    return payload;
}

const unexpected = what => Object.assign(new TarifaError(`El servicio de Aptus devolvió ${what} con formato inesperado.`, 502), { stage: 'response', outcome_unknown: true });

export default class TarifaClienteService {
    constructor(organizationId, { api = null, req = null } = {}) {
        if (!orgId(organizationId)) throw new TarifaError('Organización inválida.');
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    cobertura() {
        return this.api.request('get', '/tarifas/cobertura', { stage: 'tarifas_cobertura' });
    }

    async createTarifa(body) {
        const payload = validateTarifa(body);
        const data = await this.api.request('post', '/tarifas', { data: payload, stage: 'create_tarifa' });
        if (!data || !Number.isInteger(data.id)) throw unexpected('una tarifa');
        return data;
    }

    // Antes de editar o borrar se confirma que la tarifa es de las que se manejan aquí.
    async editable(id) {
        if (!idParam(id)) throw new TarifaError('ID de tarifa inválido.');
        const tarifa = await this.api.request('get', '/tarifas/' + id, { stage: 'get_tarifa' });
        if (!tarifa || !Number.isInteger(tarifa.id)) throw unexpected('una tarifa');
        const nivel = tarifa.nivel || nivelDe(tarifa);
        if (!NIVELES_EDITABLES.includes(nivel)) throw noEditable(nivel);
        return tarifa;
    }

    async updateTarifa(id, body) {
        if (!isObject(body) || !money(body.tarifa)) throw new TarifaError('tarifa debe ser un número ≥ 0 con máximo 2 decimales.');
        await this.editable(id);
        const data = await this.api.request('patch', '/tarifas/' + id, { data: { tarifa: body.tarifa }, stage: 'update_tarifa' });
        if (!data || !Number.isInteger(data.id)) throw unexpected('una tarifa');
        return data;
    }

    async deleteTarifa(id) {
        await this.editable(id);
        return this.api.request('delete', '/tarifas/' + id, { stage: 'delete_tarifa' });
    }

    async impuestos() {
        const data = await this.api.request('get', '/zoho/impuestos', { stage: 'impuestos' });
        if (!Array.isArray(data)) throw unexpected('los impuestos');
        return data;
    }

    clienteConfig(id) {
        if (!clienteId(id)) throw new TarifaError('ID de cliente inválido.');
        return this.api.request('get', '/clientes/' + id + '/config', { stage: 'cliente_config' });
    }

    // El impuesto debe existir en Books (se revisa en la lista de impuestos para dar un mensaje claro).
    async updateClienteConfig(id, body) {
        if (!clienteId(id)) throw new TarifaError('ID de cliente inválido.');
        const payload = validateClienteConfig(body);
        if (payload.zoho_tax_id) {
            const lista = await this.impuestos();
            if (!lista.some(t => String(t.zoho_id) === payload.zoho_tax_id)) throw new TarifaError('Ese impuesto no existe en Books.', 422);
        }
        const data = await this.api.request('patch', '/clientes/' + id + '/config', { data: payload, stage: 'update_cliente_config' });
        if (!isObject(data)) throw unexpected('la configuración del cliente');
        return data;
    }
}
