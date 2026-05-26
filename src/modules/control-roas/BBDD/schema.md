# Esquema Funcional

## `workspaces`

Agrupa la información por espacio de trabajo.

- `id`
- `nombre`
- `owner_id`

## `workspace_members`

Gestiona usuarios asociados a cada workspace.

- `workspace_id`
- `user_id`
- `email`
- `rol`
- `estado`
- `invitado_por`
- `invitado_en`

Roles válidos: `superadmin`, `owner`, `admin`, `editor`, `viewer`.

Los usuarios `jorgeluis@limaretail.com` y `diego@limaretail.com` se elevan a `superadmin` con `superadmin.sql`, lo que les permite visualizar y gestionar los miembros de todos los workspaces.

## `empresas`

Catálogo de empresas/clientes del workspace.

- `id`
- `workspace_id`
- `nombre`

## `registros_roas`

Registros de performance, inversión, resultados y ventas.

- `fecha`
- `fecha_inicio`
- `fecha_fin`
- `periodo_tipo`
- `empresa`
- `empresa_id`
- `workspace_id`
- `user_id`
- `tipo_resultado`
- `gasto`
- `resultados`
- `ventas`
- `ticket_promedio`
- `canal`
- `campana`
- `notas`
- `costo_por_resultado`
- `facturacion_estimada`
- `roas`
- `ratio_venta`

## `costos`

Costos e ingresos consolidados por empresa y periodo.

- `workspace_id`
- `empresa_id`
- `periodo_tipo`
- `fecha_inicio`
- `fecha_fin`
- `inversion_meta`
- `inversion_google`
- `costo_ias`
- `costo_manychat`
- `costo_diseno`
- `otros_variables`
- `otros_fijos`
- `leads_cotizaciones`
- `leads_generados`
- `ventas_cerradas`
- `ingreso_generado`

