# Historial de cambios

🇬🇧 [English](CHANGELOG.md) · 🇪🇸 Español

## Sin publicar
- Reporte: el filtro **Ver** ahora es un panel con buscador y chips (programas, grupos y aspersores en columnas) en lugar de
  una lista desplegable larga; **Medir** pasa a ser Tiempo / Litros y explica cómo activar los litros si no hay caudal cargado.

## 1.5.0 — 2026-10-18
- Nuevo **reporte de riego** en el Panel: barras apiladas por programa, ciclos completos y omitidos, indicadores con la
  variación respecto del período anterior; agrupado por día, semana, mes o año; filtro por programa, grupo o aspersor;
  tiempo o litros estimados. Pasá el mouse o tocá una barra para ver el detalle de ese período, con cada aspersor en
  columnas (por controlador, dispositivo o área).
- Los totales diarios por programa y aspersor se guardan por años en `.storage/sk_irrigation.data.stats` (nuevo comando
  websocket `sk_irrigation/stats`) y se completan con el historial existente al primer arranque.

## 1.4.0 — 2026-10-17
- Nueva pestaña **Mapa**: dibujá el área de cada aspersor sobre una foto de dron / plano o sobre la vista satelital y mirá en
  vivo cuál está regando (ondas de agua, tiempo transcurrido y restante), cuál sigue y cuáles ya regaron. Varios mapas (por
  ejemplo, uno por controlador), varias áreas por aspersor, ubicación con drag & drop, edición de vértices y riego rápido desde el mapa.
- **Seguir riego** (activado de entrada): cuando un ciclo salta a un aspersor de otro mapa (por ejemplo, de un controlador
  al siguiente) el mapa cambia solo y se mueve hasta el área activa. La lista del ciclo indica en qué mapa está cada aspersor.
- Respaldo: la exportación incluye las imágenes de los mapas; importar un archivo que solo trae mapas los agrega a la configuración actual.
- Las imágenes subidas se guardan en `config/sk_irrigation/maps/` y se borran cuando ningún mapa las usa.

## 1.3.5 — 2026-10-16
- Documentación en inglés como idioma principal (README, historial de cambios y capturas), con versión completa en español.
- El título de la barra lateral de una instalación nueva y los nombres de las tarjetas en el selector siguen el idioma de Home Assistant ("Irrigation" / "Riego").

## 1.3.4 — 2026-10-16
- Corregido: si el editor de un programa estaba abierto al **importar una configuración**, seguía mostrando
  (y podía volver a guardar) los tiempos viejos. Ahora el editor se actualiza con lo importado.

## 1.3.3 — 2026-10-15
- Disponible en todos los países en HACS: se quita la restricción `country` de `hacs.json`.

## 1.3.2 — 2026-10-15
- Corregido: **"Custom element doesn't exist: sk-irrigation-…-card"** al abrir un dashboard mientras Home Assistant
  arranca (por ejemplo, justo después de actualizar y reiniciar). Los archivos del panel se publican antes,
  las tarjetas se registran también como **recurso de Lovelace** (versión actualizada automáticamente, sirve
  también para Chromecast) y se cargan por una segunda URL de respaldo si la primera falló durante el arranque.

## 1.3.1 — 2026-10-15
- Tarjetas Aspersores y Grupos: opción **Columnas** (vacío = automático) para controlar la disposición.
- Los nombres largos en las tarjetas ocupan hasta 2 líneas en lugar de cortarse, con el nombre completo al pasar el mouse.

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
