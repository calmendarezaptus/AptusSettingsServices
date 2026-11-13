"use strict";
// Función del proyecto Configuración (Catalyst): configuración de abogados del despacho. Todo pasa
// por ReportesSandbox (core/PrebillApiClient). NO escribe en Books ni crea Usuarios de Books.
import express from 'express';
import dotenv from 'dotenv';
import AbogadoConfigService from './services/AbogadoConfigService.js';
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

// ── Lecturas permitidas (GET /:organizationId/<catalogo>) y filtros que se reenvían ──
export const CATALOGS = {
    abogados: [],
    'tipos-abogado': [],
    responsables: [],
};
registerCatalogRoutes(app, CATALOGS);

// Sin `stage` a propósito: un 404 con `stage` significa "el registro ya no existe".
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada en aptus_settings_services.' }));

export default app;
