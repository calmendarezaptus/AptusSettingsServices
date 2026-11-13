import test from 'node:test';
import assert from 'node:assert/strict';
import AbogadoConfigService, { validateAbogadoPatch } from '../services/AbogadoConfigService.js';

function fixture(responses = {}) {
    const calls = [];
    const api = {
        async request(method, path, opts) {
            calls.push({ method, path, opts });
            const key = `${method} ${path}`;
            if (key in responses) return typeof responses[key] === 'function' ? responses[key]() : responses[key];
            return { id: 3 };
        },
    };
    return { service: new AbogadoConfigService('636939444', { api }), calls };
}
const writes = calls => calls.filter(c => c.method !== 'get');

test('solo los campos permitidos; nombre, correo y foto no se editan', () => {
    assert.deepEqual(validateAbogadoPatch({
        tipo_id: 4, activo: false, tarifas_propias: { MXN: 1200, USD: null }, zoho_user_id: '', responsable: 'general',
        nombre: 'X', email: 'a@b.c', foto_url: 'http://x', tarifa_propia_eur: 5,
    }), { tipo_id: 4, activo: 0, tarifa_propia_mxn: 1200, tarifa_propia_usd: '', zoho_user_id: '', responsable: 'general' });
    assert.deepEqual(validateAbogadoPatch({ responsable: null }), { responsable: null });
    for (const body of [{}, { nombre: 'X' }, { tipo_id: '4' }, { tipo_id: 0 }, { activo: 1 }, { tarifas_propias: {} }, { tarifas_propias: { COP: 1 } },
        { tarifas_propias: { MXN: -1 } }, { tarifas_propias: { MXN: 1.234 } }, { tarifas_propias: [1] }, { zoho_user_id: 446794 }, { zoho_user_id: 'abc' },
        { responsable: 'socio' }, { responsable: '' }, null, []]) {
        assert.throws(() => validateAbogadoPatch(body), undefined, JSON.stringify(body));
    }
});

test('PATCH /abogados/:id con el cuerpo validado; IDs inválidos sin llamar', async () => {
    const { service, calls } = fixture();
    await service.update('3', { activo: true, tarifas_propias: { EUR: 60 } });
    assert.deepEqual([calls[0].method, calls[0].path, calls[0].opts.data], ['patch', '/abogados/3', { activo: 1, tarifa_propia_eur: 60 }]);
    await assert.rejects(service.update('3/../tarifas', { activo: true }), e => e.status === 400);
    await assert.rejects(service.update('3', { nombre: 'X' }), e => e.status === 400);
    assert.equal(calls.length, 1);
    assert.throws(() => new AbogadoConfigService('abc', { api: {} }), e => e.status === 400);
});

test('enlazar con Books: el usuario debe existir; nunca se crea', async () => {
    const usuarios = [{ zoho_id: '446794000000052001', nombre: 'AM - Alberti Martinolli' }];
    let f = fixture({ 'get /zoho/usuarios': usuarios });
    await assert.rejects(f.service.update('3', { zoho_user_id: '999' }), e => e.status === 422);
    assert.equal(writes(f.calls).length, 0);
    await f.service.update('3', { zoho_user_id: '446794000000052001' });
    assert.deepEqual(writes(f.calls).map(c => [c.path, c.opts.data]), [['/abogados/3', { zoho_user_id: '446794000000052001' }]]);
    f = fixture();
    await f.service.update('3', { zoho_user_id: '' }); // desenlazar no consulta la lista
    assert.deepEqual(f.calls.map(c => c.method), ['patch']);
    assert.ok(!f.calls.some(c => /usuarios/.test(c.path) && c.method !== 'get'));
});

test('sincronizar llama a sincronizar-zoho; respuestas raras se marcan inciertas', async () => {
    const f = fixture({ 'post /abogados/3/sincronizar-zoho': { id: 3, foto_url: 'x' } });
    await f.service.sincronizar('3');
    assert.deepEqual(writes(f.calls).map(c => c.path), ['/abogados/3/sincronizar-zoho']);
    await assert.rejects(fixture({ 'patch /abogados/3': 'ok' }).service.update('3', { activo: true }), e => e.outcome_unknown === true);
    await assert.rejects(fixture({ 'get /zoho/usuarios': {} }).service.usuariosBooks(), e => e.status === 502);
});
