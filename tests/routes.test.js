import test from 'node:test';
import assert from 'node:assert/strict';
import app, { CATALOGS } from '../index.js';

// Sin red: sin contexto de Catalyst la conexión falla antes de salir, y debe responder 503 en JSON.
test('rutas: lecturas permitidas, el resto 404, validación sin red y sin conexión 503', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/636939444`;
    const send = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const original = console.error; console.error = () => {};
    try {
        for (const catalog of [...Object.keys(CATALOGS), 'usuarios-books', 'abogados/3']) {
            const r = await send('GET', '/' + catalog);
            assert.equal(r.status, 503, catalog);
            assert.equal((await r.json()).stage, 'connection');
        }
        assert.equal((await send('GET', '/tiempos')).status, 404);
        assert.equal((await send('POST', '/abogados', { nombre: 'X', tipo_id: 1 })).status, 404); // no se crean abogados aquí
        assert.equal((await send('DELETE', '/abogados/3')).status, 404);
        let r = await send('GET', '/a/b/c');
        assert.equal(r.status, 404); assert.equal((await r.json()).stage, undefined);
        assert.equal((await send('PATCH', '/abogados/3', { nombre: 'X' })).status, 400);
        assert.equal((await send('PATCH', '/abogados/x', { activo: true })).status, 400);
        assert.equal((await fetch(base.replace('636939444', 'abc') + '/abogados')).status, 400);
        r = await send('PATCH', '/abogados/3', { activo: true });
        assert.equal(r.status, 503); assert.equal((await r.json()).outcome_unknown, false);
        assert.equal((await send('POST', '/abogados/3/sincronizar-books')).status, 503);
    } finally { server.close(); console.error = original; }
});
