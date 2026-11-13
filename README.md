# aptus_settings_services

Función de Catalyst (Node 24, Express 5, Advanced I/O) del proyecto **Configuración**: configuración
de abogados (nivel, activo, tarifa propia, enlace con Books, responsable). Documento del proyecto:
`05-configuracion/PROYECTO.md` en el repositorio de trabajo `AptusWidgets`.

**No escribe en Books ni crea Usuarios de Books.**

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `index.js` | Rutas |
| `services/` | `AbogadoConfigService`: lista blanca de campos del abogado |
| `core/` | **No editar.** Copia de `shared/catalyst-core/src`. Se actualiza con `node shared/catalyst-core/sync.mjs` desde el repositorio de trabajo |
| `tests/` | `npm test` (sin red; nunca escriben) |

## Secretos

`AUTH_TOKEN` (token del broker Donatello): variable de entorno de la función en Catalyst, o `.env`
local (ver `.env.example`). `.env` no se versiona.

## Comandos

```bash
npm install
npm test
```
