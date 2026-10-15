# Changelog

## 1.3.0 — 2026-10-15
- **Línea de tiempo interactiva** en el editor de programas: arrastrá el borde de una barra para cambiar
  el tiempo de ese aspersor (pasos de 30 s) o la barra entera para cambiar su orden de encendido; zoom
  con desplazamiento horizontal para ciclos largos.
- **Tarjetas para dashboards** (se cargan solas, sin recursos manuales): Estado, Ciclos, Grupos y Aspersores,
  con editor visual y una única suscripción compartida.
- Condiciones: **autocompletado** del campo Entidad con estado actual, **valores sugeridos** para condiciones de
  estado y aviso de entidad inexistente.
- Omisión rápida: explicación de uso, estado en vivo de cada sensor de lluvia, aviso de sensores no binarios
  y resaltado del clima actual.
- El estado y las tarjetas reaccionan **al instante** cuando cambia un sensor usado en condiciones.
- Duración estimada de cada ciclo disponible para las tarjetas.
- Botón de donación **Invitame un café** (PayPal) en README, GitHub Sponsor y Ajustes.

## 1.2.2 — 2026-10-15
- README compatible con el visor de HACS: imágenes con URL absoluta y diagrama de flujo como imagen
  (HACS no resuelve rutas relativas ni dibuja Mermaid). Sin cambios funcionales.

## 1.2.1 — 2026-10-15
- **Selector de entidades propio** que reemplaza los desplegables nativos: buscador por nombre, área,
  controlador o entity_id; agrupado por área de HA; navegación con teclado; selección múltiple
  ("Agregar aspersor" permite sumar varios a la vez); hoja inferior en celulares.
- Aplica a "Agregar aspersor", sensores de lluvia, clima, temperatura, presupuesto, válvula maestra,
  notificaciones y a las entidades de las condiciones.
- Lista de aspersores: filtro **Sugeridos** por defecto (Rain Bird, válvulas y nombres de riego), filtro de
  área compacto, contador "mostrando N de M" y nombre del controlador para distinguir zonas homónimas.
- Se excluyen los switches propios del módulo de las listas de dispositivos.
- Ajustes: grilla de 2 columnas sin huecos en pantallas anchas; ancho máximo del panel ampliado.
- Corregido: el selector vacío se veía más alto que los demás; los avisos (toast) desaparecían al refrescar.

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
