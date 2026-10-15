# Changelog

## 1.2.0 — 2026-10-15
- **Condiciones personalizadas** sin YAML: de estado (es / no es), numéricas (mayor/menor que, también sobre
  atributos) y plantillas Jinja. Globales (Ajustes) y por programa; indicador en vivo ✓/✗ con el valor actual.
- Opción **re-verificar antes de cada aspersor y durante el riego**: si deja de cumplirse (p. ej. batería o
  generador) el riego se detiene, se apaga la bomba y queda en el historial con el motivo.
- Comportamiento si el sensor no está disponible: no regar o ignorar la condición.
- Las condiciones se aplican también a riegos manuales y servicios (configurable); el panel avisa el motivo.
- Los aspersores `unavailable`/`unknown` se saltean y la secuencia continúa.
- Ícono y logo propios (`brand/`, HA 2026.3+) visibles en HA y HACS; README rediseñado con banner.
- Nuevo sensor **Aspersor actual** con `ends_at` y `remaining_seconds` (reemplaza timers auxiliares).

## 1.1.0 — 2026-10-15
- Flujo simplificado: **Aspersores (dispositivos de HA) → Grupos → Programas**. Se elimina la pestaña Zonas.
- Los dispositivos de HA se leen automáticamente con su **área nativa**; se arrastran directo a los grupos
  (filtros por área, Rain Bird y "sin grupo"; botón para crear grupos desde las áreas de HA).
- En cada programa, **orden de encendido por drag & drop** de los aspersores de cada grupo, tiempo
  igual para todos o uno por uno, y switch para omitir un aspersor solo en ese programa.

## 1.0.0 — 2026-10-15
- Primera versión: panel de riego, zonas, grupos drag & drop, programas con calendario avanzado,
  múltiples horarios, encendido simultáneo por paso, tiempos fijos o por aspersor, vista previa Gantt,
  condiciones de lluvia/clima/helada, presupuesto hídrico, válvula maestra, historial, servicios y entidades.
