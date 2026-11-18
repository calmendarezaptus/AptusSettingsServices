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
        for (const catalog of [...Object.keys(CATALOGS), 'usuarios-books', 'abogados/3', 'config-despacho', 'conceptos-factura', 'conceptos-factura/faltantes', 'articulos-books']) {
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
        // Despacho: validación sin red; lo válido llega a la conexión (503)
        assert.equal((await send('PATCH', '/config-despacho', { otra: { a: 1 } })).status, 400);
        assert.equal((await send('PATCH', '/config-despacho', { factura: { modo: 'tarea' } })).status, 503);
        assert.equal((await send('POST', '/config-despacho/restablecer', { seccion: 'x' })).status, 400);
        assert.equal((await send('POST', '/config-despacho/restablecer', {})).status, 503);
        assert.equal((await send('PATCH', '/conceptos-factura/otro', { item_id_es: '1' })).status, 400);
        assert.equal((await send('POST', '/conceptos-factura/crear-en-books', { confirmar: 1 })).status, 404); // crear en Books no existe aquí
        assert.equal((await send('POST', '/tipos-abogado', { nombre: 'Socio' })).status, 400);
        assert.equal((await send('POST', '/tipos-abogado', { nombre: 'Socio', tarifa_mxn: 1 })).status, 503);
        assert.equal((await send('PATCH', '/tareas-estandar/9', { activo: false })).status, 503);
        assert.equal((await send('DELETE', '/tareas-estandar/9')).status, 404);
        assert.equal((await send('DELETE', '/tipos-abogado/9')).status, 503);
        // Tarifas y clientes
        for (const path of ['/tarifas/cobertura', '/impuestos', '/clientes/446794000015629019/config']) assert.equal((await send('GET', path)).status, 503, path);
        assert.equal((await send('POST', '/tarifas', { moneda: 'MXN', tarifa: 1000 })).status, 503);
        assert.equal((await send('POST', '/tarifas', { moneda: 'MXN', tarifa: 1000, abogado_id: 3 })).status, 403);
        assert.equal((await send('POST', '/tarifas', { moneda: 'MXN', tarifa: 1000, proyecto_id: 3 })).status, 403);
        assert.equal((await send('POST', '/tarifas', { moneda: 'MXN', tarifa: -1 })).status, 400);
        assert.equal((await send('PATCH', '/tarifas/x', { tarifa: 1 })).status, 400);
        assert.equal((await send('PATCH', '/tarifas/10', { tarifa: 1 })).status, 503);
        assert.equal((await send('DELETE', '/tarifas/10')).status, 503);
        assert.equal((await send('PATCH', '/clientes/9/config', { idioma: 'fr' })).status, 400);
        assert.equal((await send('PATCH', '/clientes/9/config', { idioma: 'en' })).status, 503);
    } finally { server.close(); console.error = original; }
});
