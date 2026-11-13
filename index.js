"use strict";
// Función del proyecto Configuración (Catalyst): abogados y configuración del despacho. Todo pasa
// por ReportesSandbox (core/PrebillApiClient). NO escribe en Books ni crea Usuarios de Books.
import express from 'express';
import dotenv from 'dotenv';
import AbogadoConfigService from './services/AbogadoConfigService.js';
import DespachoService, { CATALOGOS } from './services/DespachoService.js';
import { registerCatalogRoutes } from './core/catalogs.js';
import { sendError } from './core/http.js';

dotenv.config();

const app = express();
app.use(express.json());

// Cada ruta crea su servicio dentro del try: una organización inválida responde 400 en JSON.
const route = (internalMessage, handler) => async (req, res) => {
    try { return res.json(await handler(req)); }
    catch (error) { return sendError(res, error, internalMessage); }
};
const abogados = req => new AbogadoConfigService(req.params.organizationId, { req });

// ── Abogados ─────────────────────────────────────────────────────────────────
app.get('/:organizationId/usuarios-books', route('Error interno consultando usuarios de Books.', req => abogados(req).usuariosBooks()));
app.get('/:organizationId/abogados/:abogadoId', route('Error interno consultando el abogado.', req => abogados(req).get(req.params.abogadoId)));
app.patch('/:organizationId/abogados/:abogadoId', route('Error interno actualizando el abogado.', req => abogados(req).update(req.params.abogadoId, req.body)));
app.post('/:organizationId/abogados/:abogadoId/sincronizar-books', route('Error interno sincronizando el abogado.', req => abogados(req).sincronizar(req.params.abogadoId)));

// ── Despacho ─────────────────────────────────────────────────────────────────
const despacho = req => new DespachoService(req.params.organizationId, { req });
app.get('/:organizationId/config-despacho', route('Error interno consultando la configuración.', req => despacho(req).config()));
app.patch('/:organizationId/config-despacho', route('Error interno guardando la configuración.', req => despacho(req).updateConfig(req.body)));
app.post('/:organizationId/config-despacho/restablecer', route('Error interno restableciendo la configuración.', req => despacho(req).restablecer(req.body)));
app.get('/:organizationId/conceptos-factura', route('Error interno consultando los conceptos.', req => despacho(req).conceptos()));
app.get('/:organizationId/conceptos-factura/faltantes', route('Error interno consultando los conceptos.', req => despacho(req).conceptosFaltantes()));
app.patch('/:organizationId/conceptos-factura/:clave', route('Error interno vinculando el concepto.', req => despacho(req).updateConcepto(req.params.clave, req.body)));
app.get('/:organizationId/articulos-books', route('Error interno consultando artículos de Books.', req => despacho(req).articulos()));
for (const name of Object.keys(CATALOGOS)) {
    app.post(`/:organizationId/${name}`, route('Error interno guardando el catálogo.', req => despacho(req).createItem(name, req.body)));
    app.patch(`/:organizationId/${name}/:id`, route('Error interno guardando el catálogo.', req => despacho(req).updateItem(name, req.params.id, req.body)));
    if (CATALOGOS[name].deletable) app.delete(`/:organizationId/${name}/:id`, route('Error interno borrando del catálogo.', req => despacho(req).deleteItem(name, req.params.id)));
}

// ── Lecturas permitidas (GET /:organizationId/<catalogo>) y filtros que se reenvían ──
export const CATALOGS = {
    abogados: [],
    'tipos-abogado': [],
    responsables: [],
    'tareas-estandar': ['todos'],
    'categorias-gasto': ['todos'],
};
registerCatalogRoutes(app, CATALOGS);

// Sin `stage` a propósito: un 404 con `stage` significa "el registro ya no existe".
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada en aptus_settings_services.' }));

export default app;
