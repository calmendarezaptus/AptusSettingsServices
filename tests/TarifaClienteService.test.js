import test from 'node:test';
import assert from 'node:assert/strict';
import TarifaClienteService, { nivelDe, validateTarifa, validateClienteConfig } from '../services/TarifaClienteService.js';

function fixture(responses = {}) {
    const calls = [];
    const api = {
        async request(method, path, opts) {
            calls.push({ method, path, opts });
            const key = `${method} ${path}`;
            if (key in responses) return typeof responses[key] === 'function' ? responses[key]() : responses[key];
            return { id: 5 };
        },
    };
    return { service: new TarifaClienteService('636939444', { api }), calls };
}
const writes = calls => calls.filter(c => c.method !== 'get');

test('nivelDe sigue la jerarquía', () => {
    assert.equal(nivelDe({}), 'general');
    assert.equal(nivelDe({ cliente_id: '9' }), 'cliente');
    assert.equal(nivelDe({ cliente_id: '9', tipo_id: 2 }), 'cliente_tipo');
    assert.equal(nivelDe({ cliente_id: '9', abogado_id: 2 }), 'cliente_abogado');
    assert.equal(nivelDe({ abogado_id: 2, cliente_id: null }), 'abogado');
    assert.equal(nivelDe({ tipo_id: 2 }), 'tipo');
    assert.equal(nivelDe({ proyecto_id: 3, abogado_id: 2 }), 'proyecto_abogado');
});

test('validateTarifa: general y de cliente; abogado, nivel y proyecto → 403 con dónde editarlas', () => {
    assert.deepEqual(validateTarifa({ moneda: 'MXN', tarifa: 1500 }), { moneda: 'MXN', tarifa: 1500 });
    assert.deepEqual(validateTarifa({ moneda: 'USD', tarifa: 90.5, cliente_id: '446794000015629019', tipo_id: 3, abogado_id: null }),
        { moneda: 'USD', tarifa: 90.5, cliente_id: '446794000015629019', tipo_id: 3 });
    const status = body => { try { validateTarifa(body); return 'ok'; } catch (e) { return e.status; } };
    assert.equal(status({ moneda: 'MXN', tarifa: 1, abogado_id: 2 }), 403);
    assert.equal(status({ moneda: 'MXN', tarifa: 1, tipo_id: 2 }), 403);
    assert.equal(status({ moneda: 'MXN', tarifa: 1, proyecto_id: 5 }), 403);
    assert.throws(() => validateTarifa({ moneda: 'MXN', tarifa: 1, abogado_id: 2 }), /Configuración de abogados/);
    for (const body of [null, [], { moneda: 'GBP', tarifa: 1 }, { moneda: 'MXN', tarifa: -1 }, { moneda: 'MXN', tarifa: 1.234 }, { moneda: 'MXN', tarifa: '10' },
        { moneda: 'MXN', tarifa: 1, cliente_id: 'abc' }, { moneda: 'MXN', tarifa: 1, cliente_id: '9', abogado_id: 1, tipo_id: 2 }, { moneda: 'MXN', tarifa: 1, cliente_id: '9', abogado_id: 1.5 }]) {
        assert.equal(status(body), 400, JSON.stringify(body));
    }
});

test('validateClienteConfig: impuesto por ID o vacío; idioma es, en o vacío', () => {
    assert.deepEqual(validateClienteConfig({ zoho_tax_id: '446794000008083135', idioma: 'en', otro: 1 }), { zoho_tax_id: '446794000008083135', idioma: 'en' });
    assert.deepEqual(validateClienteConfig({ zoho_tax_id: '', idioma: '' }), { zoho_tax_id: '', idioma: '' });
    for (const body of [{}, null, { idioma: 'fr' }, { zoho_tax_id: 'IVA' }, { zoho_tax_id: 16 }]) assert.throws(() => validateClienteConfig(body), undefined, JSON.stringify(body));
});

test('editar o borrar: solo tarifas general y de cliente, revisando antes', async () => {
    const propia = { id: 7, nivel: 'abogado', abogado_id: 3 };
    const cliente = { id: 10, nivel: 'cliente_abogado', cliente_id: '9', abogado_id: 2 };
    let { service, calls } = fixture({ 'get /tarifas/7': propia, 'get /tarifas/10': cliente });
    await assert.rejects(service.updateTarifa('7', { tarifa: 1 }), e => e.status === 403);
    await assert.rejects(service.deleteTarifa('7'), e => e.status === 403);
    assert.equal(writes(calls).length, 0);
    await service.updateTarifa('10', { tarifa: 2500, moneda: 'USD' });
    await service.deleteTarifa('10');
    assert.deepEqual(writes(calls).map(c => [c.method, c.path, c.opts.data]), [['patch', '/tarifas/10', { tarifa: 2500 }], ['delete', '/tarifas/10', undefined]]);
    ({ service, calls } = fixture());
    await assert.rejects(service.updateTarifa('x', { tarifa: 1 }), /inválido/);
    await assert.rejects(service.updateTarifa('10', { tarifa: -5 }), /tarifa/);
    assert.equal(calls.length, 0);
});

test('IVA del cliente: el impuesto debe existir en Books (422) y no se escribe si no', async () => {
    const impuestos = [{ zoho_id: '446794000008083135', nombre: 'IVA', porcentaje: 16 }];
    const { service, calls } = fixture({ 'get /zoho/impuestos': impuestos, 'patch /clientes/9/config': { cliente_id: '9', idioma: 'en' } });
    await assert.rejects(service.updateClienteConfig('9', { zoho_tax_id: '123' }), e => e.status === 422);
    assert.equal(writes(calls).length, 0);
    await service.updateClienteConfig('9', { zoho_tax_id: '446794000008083135', idioma: 'en' });
    await service.updateClienteConfig('9', { idioma: '' });
    assert.deepEqual(writes(calls).map(c => c.opts.data), [{ zoho_tax_id: '446794000008083135', idioma: 'en' }, { idioma: '' }]);
    await assert.rejects(service.updateClienteConfig('x', { idioma: 'es' }), /cliente/);
    await assert.rejects(service.createTarifa({ moneda: 'MXN', tarifa: 1, proyecto_id: 1 }), e => e.status === 403);
});
