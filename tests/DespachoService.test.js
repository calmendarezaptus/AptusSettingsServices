import test from 'node:test';
import assert from 'node:assert/strict';
import DespachoService, { validateConfigPatch, validateRestablecer, validateConcepto, CATALOGOS } from '../services/DespachoService.js';

function fixture(responses = {}) {
    const calls = [];
    const api = {
        async request(method, path, opts) {
            calls.push({ method, path, opts });
            const key = `${method} ${path}`;
            if (key in responses) return responses[key];
            return { id: 5, config: {} };
        },
    };
    return { service: new DespachoService('636939444', { api }), calls };
}
const writes = calls => calls.filter(c => c.method !== 'get');

test('config: solo secciones y campos conocidos; fuentes de responsables normalizadas', () => {
    assert.deepEqual(validateConfigPatch({ factura: { modo: 'detallado' } }), { factura: { modo: 'detallado' } });
    assert.deepEqual(validateConfigPatch({ responsables: { facturacion: { fuentes: [{ tipo: 'rol_proyecto', rol: ' Admin Firm ', extra: 1 }, { tipo: 'local', campo: 'x' }] } } }),
        { responsables: { facturacion: { fuentes: [{ tipo: 'rol_proyecto', rol: 'Admin Firm' }, { tipo: 'local' }] } } });
    for (const body of [{}, null, [], { otra: { a: 1 } }, { factura: {} }, { factura: { color: 1 } }, { factura: 'x' },
        { responsables: { facturacion: { fuentes: [] } } }, { responsables: { cobranza: { fuentes: [{ tipo: 'campo_cliente', campo: 'analista' }] } } },
        { responsables: { cobranza: { fuentes: [{ tipo: 'rol_proyecto' }] } } }, { responsables: { cobranza: { fuentes: Array(6).fill({ tipo: 'local' }) } } },
        { respaldo: { usuario_books_omision: 'abc' } }, { formatos: { despacho: { nombre: 'x'.repeat(20001) } } }]) {
        assert.throws(() => validateConfigPatch(body), undefined, JSON.stringify(body)?.slice(0, 80));
    }
    assert.deepEqual(validateRestablecer({}), {});
    assert.deepEqual(validateRestablecer({ seccion: 'cfdi' }), { seccion: 'cfdi' });
    assert.throws(() => validateRestablecer({ seccion: 'todo' }));
});

test('config: el usuario por omisión debe existir en Books; nunca se manda otra cosa', async () => {
    let f = fixture({ 'get /zoho/usuarios': [{ zoho_id: '111' }] });
    await assert.rejects(f.service.updateConfig({ respaldo: { exigir_usuario_books: false, usuario_books_omision: '222' } }), e => e.status === 422);
    assert.equal(writes(f.calls).length, 0);
    await f.service.updateConfig({ respaldo: { exigir_usuario_books: false, usuario_books_omision: '111' } });
    assert.deepEqual(writes(f.calls).map(c => [c.method, c.path, c.opts.data]), [['patch', '/config-despacho', { respaldo: { exigir_usuario_books: false, usuario_books_omision: '111' } }]]);
    f = fixture({ 'patch /config-despacho': { ok: true } });
    await assert.rejects(f.service.updateConfig({ factura: { modo: 'tarea' } }), e => e.outcome_unknown === true);
});

test('conceptos: solo vincula artículos que existen; faltantes nunca confirma', async () => {
    assert.deepEqual(validateConcepto({ item_id_es: '1', otro: 2 }), { item_id_es: '1' });
    for (const body of [{}, { item_id_es: 1 }, { item_id_en: 'x' }]) assert.throws(() => validateConcepto(body));
    const f = fixture({ 'get /zoho/articulos': [{ zoho_id: '10' }, { zoho_id: '20' }], 'post /conceptos-factura/crear-en-books': { faltantes: [] } });
    await assert.rejects(f.service.updateConcepto('honorarios', { item_id_es: '99' }), e => e.status === 422);
    await assert.rejects(f.service.updateConcepto('otro', { item_id_es: '10' }), e => e.status === 400);
    await f.service.updateConcepto('gastos', { item_id_es: '10', item_id_en: '20' });
    await f.service.conceptosFaltantes();
    assert.deepEqual(writes(f.calls).map(c => [c.method, c.path, c.opts.data]), [
        ['patch', '/conceptos-factura/gastos', { item_id_es: '10', item_id_en: '20' }],
        ['post', '/conceptos-factura/crear-en-books', {}],
    ]);
});

test('catálogos: niveles con tarifas, tareas y categorías; solo los niveles se borran', async () => {
    const v = (name, body, create) => CATALOGOS[name].validate(body, create);
    assert.deepEqual(v('tipos-abogado', { nombre: ' Socio ', tarifa_mxn: 3500, tarifa_usd: null }, true), { nombre: 'Socio', tarifa_mxn: 3500 });
    assert.deepEqual(v('tipos-abogado', { tarifa_usd: null }, false), { tarifa_usd: '' });
    assert.throws(() => v('tipos-abogado', { nombre: 'Socio' }, true)); // sin tarifa
    assert.throws(() => v('tipos-abogado', { nombre: 'S', tarifa_mxn: -1 }, true));
    assert.deepEqual(v('tareas-estandar', { nombre: 'Juntas', codigo_utbms: 'l120', facturable: 0, activo: true }, true), { nombre: 'Juntas', codigo_utbms: 'L120', facturable: 0 });
    assert.deepEqual(v('tareas-estandar', { activo: false, orden: 30 }, false), { activo: 0, orden: 30 });
    assert.throws(() => v('tareas-estandar', { nombre: 'X', facturable: true }, true));
    assert.deepEqual(v('categorias-gasto', { nombre: 'Notario', tipo: 'reembolso' }, true), { nombre: 'Notario', tipo: 'reembolso' });
    assert.throws(() => v('categorias-gasto', { nombre: 'X', tipo: 'otro' }, true));
    assert.throws(() => v('categorias-gasto', { nombre: 'X', codigo_utbms: 'E-107' }, true));

    const f = fixture();
    await f.service.createItem('tipos-abogado', { nombre: 'Socio', tarifa_mxn: 3500 });
    await f.service.updateItem('tareas-estandar', '9', { activo: false });
    await f.service.deleteItem('tipos-abogado', '4');
    await assert.rejects(f.service.deleteItem('tareas-estandar', '9'), e => e.status === 404);
    await assert.rejects(f.service.updateItem('categorias-gasto', '9', {}), e => e.status === 400);
    await assert.rejects(f.service.updateItem('categorias-gasto', '9/x', { activo: true }), e => e.status === 400);
    assert.deepEqual(writes(f.calls).map(c => `${c.method} ${c.path}`), ['post /tipos-abogado', 'patch /tareas-estandar/9', 'delete /tipos-abogado/4']);
});
