<p align="center">
  <img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/banner.es.png" alt="SK Irrigation Manager for Home Assistant" width="100%">
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=SkynetCom&repository=sk-irrigation-manager-ha&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Abrir en HACS"></a>
  <a href="https://my.home-assistant.io/redirect/config_flow_start/?domain=sk_irrigation"><img src="https://my.home-assistant.io/badges/config_flow_start.svg" alt="Agregar integración"></a>
  <br><a href="https://www.paypal.com/donate/?business=gerencia%40skynetcom.com.ar&currency_code=USD&item_name=SK+Irrigation+Manager"><img src="https://img.shields.io/badge/%E2%98%95%20Invitame%20un%20caf%C3%A9-PayPal-ffdd00?logo=paypal&logoColor=003087&labelColor=ffdd00&style=for-the-badge" alt="Invitame un café"></a>
</p>

<p align="center">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/releases"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSkynetCom%2Fsk-irrigation-manager-ha%2Fmain%2Fcustom_components%2Fsk_irrigation%2Fmanifest.json&query=%24.version&prefix=v&label=versi%C3%B3n&color=1e88e5&cacheSeconds=3600" alt="Versión"></a>
  <a href="https://hacs.xyz/docs/faq/custom_repositories"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS"></a>
  <img src="https://img.shields.io/badge/Home%20Assistant-2024.11%2B-18bcf2?logo=homeassistant&logoColor=white" alt="Home Assistant">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/actions/workflows/validate.yml"><img src="https://github.com/SkynetCom/sk-irrigation-manager-ha/actions/workflows/validate.yml/badge.svg" alt="Validate"></a>
  <img src="https://img.shields.io/badge/idiomas-ES%20%7C%20EN-2e9e6b" alt="Idiomas">
  <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-8e44ad" alt="Licencia"></a>
</p>

<p align="center">
  <b>Gestor de riego profesional para Home Assistant</b> — panel propio, grupos con drag &amp; drop,<br>
  programas con varios horarios, encendido simultáneo, condiciones inteligentes y soporte nativo para <b>Rain Bird</b>.<br>
  <sub>🇬🇧 <a href="https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/README.md">English</a> · 🇪🇸 Español</sub>
</p>

---

## ✨ Destacados

<table>
<tr>
<td width="33%" valign="top">

### 🧩 Drag &amp; drop
Arrastrá tus dispositivos de Home Assistant a grupos y armá la secuencia de cada programa arrastrando grupos y aspersores. Funciona con mouse y en pantallas táctiles.

</td>
<td width="33%" valign="top">

### 🗓️ Programas flexibles
Varios horarios por día (hora fija, amanecer o atardecer). Días de la semana, cada N días, días del mes, pares o impares, fechas puntuales y meses activos.

</td>
<td width="33%" valign="top">

### 💦 Encendido a medida
Secuencial o de a 2, 3, 4… aspersores a la vez, con una cola continua. Tiempo igual para todos o **uno por uno**, en el orden que elijas.

</td>
</tr>
<tr>
<td valign="top">

### 🌦️ Condiciones inteligentes
Sensores de lluvia, mm acumulados, clima, helada, energía solar o batería, o cualquier plantilla Jinja. Se pueden **re-verificar durante el riego** y cortarlo si dejan de cumplirse.

</td>
<td valign="top">

### 📊 Línea de tiempo interactiva
Ves cada aspersor en un Gantt y lo ajustás **arrastrando**: el borde cambia el tiempo y la barra cambia el orden. Con zoom para ciclos largos y la duración y los litros en vivo.

</td>
<td valign="top">

### 🛡️ Seguro por diseño
Válvula maestra o bomba, límite hidráulico de aspersores simultáneos, tiempo máximo por aspersor, cierre de válvulas tras un reinicio y salto de los aspersores no disponibles.

</td>
</tr>
<tr>
<td colspan="3" valign="top">

### 🗺️ Mapa en vivo
Dibujá el área de cada aspersor sobre tu **foto de dron, plano o imagen satelital** y mirá el predio en vivo: el área activa se ilumina con ondas y muestra hace cuánto está regando, el próximo aparece remarcado y el mapa sigue el ciclo de un controlador al siguiente. [Ver la sección Mapa ↓](#%EF%B8%8F-mapa)

</td>
</tr>
</table>

## 🧭 Cómo funciona

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/flow.es.png" alt="Aspersores → Grupos → Programas → Condiciones → Riego" width="100%"></p>

## 📸 Capturas

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/dashboard.es.png" alt="Panel en vivo" width="100%"></p>

<table>
<tr><th width="50%">Grupos con drag &amp; drop</th><th width="50%">Editor de programas con vista previa</th></tr>
<tr><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/groups.es.png" alt="Grupos"></td><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/program-editor.es.png" alt="Editor de programas"></td></tr>
<tr><th>Condiciones personalizadas</th><th>Programas (tema oscuro)</th></tr>
<tr><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/conditions.es.png" alt="Condiciones"></td><td><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/programs.es.png" alt="Programas"></td></tr>
</table>

> 💡 ¿Querés probar la interfaz sin instalar nada? Abrí [`dev/demo.html`](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/dev/demo.html) con un servidor local (ver [Desarrollo](#-desarrollo)).

## 📈 Reporte de riego

El Panel incluye un reporte de cuánto regó cada aspersor, grupo y programa: **barras apiladas por programa**, líneas de **ciclos completos y omitidos** (por lluvia o condiciones) y totales con la variación respecto del período anterior. Agrupalo por **día, semana, mes o año**, filtralo por programa, grupo o aspersor, y elegí ver tiempo regado o litros estimados (según el caudal de cada aspersor).

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/report.es.png" alt="Reporte de riego" width="100%"></p>

Pasá el mouse (o tocá, en el celular) una barra para ver el detalle de ese período: los totales de un lado y **cada aspersor** del otro, en columnas por controlador, dispositivo o área. Los totales diarios se guardan **por años** en un archivo propio, aparte del historial de riegos, y el reporte arranca con el historial que ya tenés.

## 🗺️ Mapa

Subí una **foto de dron o un plano** de tu terreno (o usá la vista **satelital**), dibujá el área de cada aspersor y mirá el predio en vivo: el aspersor que riega se ilumina con ondas de agua y una etiqueta que dice **hace cuánto está encendido** y cuánto le falta; el próximo aparece remarcado, y también se distinguen los que ya regaron y los que no riegan en ese ciclo. Tocá un área para regarla 5, 10 o 15 minutos.

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/map.es.png" alt="Pestaña Mapa" width="100%"></p>

- **Varios mapas**, por ejemplo uno por controlador y una vista satelital de todo el predio. Con **Seguir riego** activado, el mapa cambia y se mueve solo cuando un ciclo salta de un controlador o de un rincón del terreno a otro.
- **Arrastrá** un aspersor de la lista al mapa y ajustá su contorno: mové las esquinas, arrastrá los puntos intermedios para sumar esquinas, doble clic en una esquina para borrarla y ✥ para mover toda el área.
- Un aspersor puede tener **varias áreas separadas** (dos franjas de césped, un cantero a cada lado…); se encienden todas juntas.
- Los mapas son parte de tu configuración: **Ajustes → Respaldo** los exporta con sus imágenes, y un archivo que solo trae mapas se **agrega** a la configuración actual en lugar de reemplazarla.

## 🧩 Tarjetas para dashboards

La integración trae 4 tarjetas que **se cargan solas**: no hace falta agregar recursos. Editá un dashboard → **Agregar tarjeta** → buscá **"SK Riego"**.

<p align="center"><img src="https://raw.githubusercontent.com/SkynetCom/sk-irrigation-manager-ha/main/docs/cards.es.png" alt="Tarjetas para dashboards" width="100%"></p>

| Tarjeta | Qué muestra | Opciones |
|---|---|---|
| `custom:sk-irrigation-status-card` | Riego en curso con cuenta regresiva, aspersores activos, saltar/detener, próximo riego, condiciones, sistema y retraso por lluvia | `title`, `show_controls` |
| `custom:sk-irrigation-programs-card` | Ciclos con horarios, duración, próximo riego, aviso si no se ejecutaría, activar y regar ahora | `title`, `show_run`, `show_disabled` |
| `custom:sk-irrigation-groups-card` | Grupos con sus aspersores encendidos en vivo y riego rápido del grupo | `title`, `group`, `columns`, `minutes`, `concurrency` |
| `custom:sk-irrigation-zones-card` | Grilla de aspersores con estado, último riego y riego manual | `title`, `group`, `columns`, `minutes` |

`columns` fija la cantidad de columnas (por ejemplo `8` para una tarjeta a todo el ancho). Si se deja vacío, se ajusta solo.

```yaml
type: custom:sk-irrigation-groups-card
title: Riego del frente
group: Jardín frontal   # nombre o id; vacío = todos
minutes: [5, 10, 15]
concurrency: 2
columns: 3
```

## 🚀 Instalación

### HACS (recomendado)
1. Tocá el botón **Abrir en HACS** de arriba, o en HACS → ⋮ → **Repositorios personalizados** agregá
   `https://github.com/SkynetCom/sk-irrigation-manager-ha` con la categoría **Integración**.
2. Instalá **SK Irrigation Manager** y **reiniciá Home Assistant**.
3. **Ajustes → Dispositivos y servicios → + Agregar integración → SK Irrigation Manager** (o el botón **Agregar integración** de arriba).
4. Aparece **Riego** en la barra lateral. Si no lo ves, recargá el navegador con Ctrl+F5.

### Manual
Copiá `custom_components/sk_irrigation` en `config/custom_components/`, reiniciá y seguí desde el paso 3.

| Requisito | Versión |
|---|---|
| Home Assistant | 2024.11 o superior |
| Ícono propio en la lista de integraciones | 2026.3 o superior (versiones anteriores muestran un ícono genérico) |

## ⚡ Puesta en marcha en 3 pasos

1. **Grupos** → arrastrá tus aspersores a grupos, o tocá **Crear grupos desde las áreas de HA**.
2. **Programas** → **Nuevo programa** → elegí días y horarios → arrastrá grupos a la secuencia. En cada grupo definí cuántos aspersores a la vez, el tiempo (igual o uno por uno) y el orden de encendido.
3. **Ajustes** → sumá tus condiciones (lluvia, clima, energía…) y, si tenés, la válvula maestra o la bomba.

¡Listo! El **Panel** muestra el próximo riego, el progreso en vivo con cuenta regresiva y el estado de cada condición.

## 🌦️ Condiciones: ejemplos

| Necesidad | Tipo | Configuración |
|---|---|---|
| No regar si llueve | Estado | `sensor.descripcion_lluvia` **es** `no_rain` |
| No regar si llovió ≥ 5 mm hoy | Numérica | `sensor.lluvia_hoy` **menor que** `5` · si no está disponible → *ignorar* |
| Solo con generador apagado | Numérica | `sensor.potencia_red` **menor que** `50` · ✅ *re-verificar durante el riego* |
| Proteger la batería | Numérica | `sensor.bateria_soc` **mayor que** `20` · ✅ *re-verificar durante el riego* |
| Lógica avanzada | Plantilla | `{{ states('sensor.viento') \| float(0) < 30 and now().hour < 9 }}` |

Las condiciones pueden ser **globales** (valen para todos los programas) o **solo de un programa**. Opcionalmente también se aplican a los riegos manuales y a los servicios.

## 🔄 ¿Venís de scripts y automatizaciones YAML?

| Antes (YAML) | Ahora |
|---|---|
| Script con `repeat: for_each` + `delay` por aspersor | Un programa con orden y tiempo por aspersor |
| Varias llamadas al script con distintas duraciones | Pasos de la secuencia, o un grupo con tiempos **uno por uno** |
| `condition:` en la automatización y en el loop | Condiciones globales o por programa, con **re-verificación** |
| `mode: queued` | Cola de ejecución incorporada |
| Script "PARAR RIEGO" | Botón **Detener todo** / servicio `sk_irrigation.stop_all` |
| `timer` auxiliar para la cuenta regresiva | Sensores **Próximo riego** y **Aspersor actual** (`ends_at`, `remaining_seconds`) |

Tu configuración se puede **exportar e importar** como JSON desde *Ajustes → Respaldo*.

## 🆚 Comparativa

| | Irrigation Unlimited | Smart Irrigation | Rain Bird (oficial) | **SK Irrigation Manager** |
|---|:---:|:---:|:---:|:---:|
| Configuración visual completa | ❌ YAML | ⚠️ Solo cálculo | ❌ | ✅ |
| Grupos con drag &amp; drop | ❌ | ❌ | ❌ | ✅ |
| N aspersores a la vez por paso | ⚠️ | ❌ | ❌ | ✅ |
| Orden y tiempo por aspersor | ⚠️ YAML | ❌ | ❌ | ✅ |
| Varios horarios por día, sol, temporadas | ✅ | — | ❌ | ✅ |
| Condiciones con re-verificación en vivo | ⚠️ Plantillas | ❌ | ❌ | ✅ |
| Vista previa / Gantt | ❌ | ❌ | ❌ | ✅ |
| Presupuesto hídrico | ✅ | ✅ | ❌ | ✅ (incluye el sensor de Smart Irrigation) |
| Duración exacta en Rain Bird | — | — | ⚠️ Fija | ✅ `rainbird.start_irrigation` |

## 🧱 Entidades y servicios

| Entidad | Descripción |
|---|---|
| **Estado** (sensor) | `idle`, `running`, `paused`, `rain_delay`, `disabled` + atributos (programa, aspersores activos, cola, motivos) |
| **Próximo riego** (sensor) | Fecha y hora del próximo riego y el programa |
| **Aspersor actual** (sensor) | Qué está regando, `ends_at` y `remaining_seconds` |
| **Tiempo restante** (sensor) | Minutos que faltan para terminar el riego en curso |
| **Zonas activas** (sensor) | Cantidad de aspersores regando |
| **Sistema de riego** (switch) | Habilita o deshabilita todos los programas |
| **Programa …** (switch) | Un switch por programa |

| Servicio | Uso |
|---|---|
| `sk_irrigation.run_program` | Ejecutar un programa (`program`: nombre o id) |
| `sk_irrigation.run_group` | Regar un grupo (`group`, `duration`, `concurrency`) |
| `sk_irrigation.run_zone` | Regar un aspersor (`zone`: nombre o entity_id, `duration`) |
| `sk_irrigation.skip` | Saltar al siguiente aspersor |
| `sk_irrigation.stop_all` | Detener todo y vaciar la cola |
| `sk_irrigation.set_rain_delay` | Suspender por N horas (0 = quitar) |

```yaml
# Ejemplo: riego extra del frente si hace calor
automation:
  - alias: Riego extra por calor
    triggers:
      - trigger: numeric_state
        entity_id: sensor.temperatura_exterior
        above: 35
    actions:
      - action: sk_irrigation.run_group
        data:
          group: "Jardín frontal"
          duration: 5
          concurrency: 2
```

## 💧 Rain Bird
La integración oficial de Rain Bird abre la zona con una duración por defecto. SK Irrigation Manager reconoce las entidades de la plataforma `rainbird` y usa `rainbird.start_irrigation` con la **duración exacta** de cada aspersor; además lo cierra al terminar o al saltarlo. Funciona con varios controladores a la vez (por ejemplo, 24 estaciones en 3 controladores). Si tu controlador limita la cantidad de zonas simultáneas, configurá el **máximo de aspersores simultáneos** en *Ajustes*.

## ❓ Preguntas frecuentes

<details><summary><b>¿Funciona con aspersores que no son Rain Bird?</b></summary>

Sí: con cualquier entidad `switch`, `valve`, `input_boolean`, `light` o `fan` (OpenSprinkler, Shelly, Sonoff, ESPHome, Zigbee, Z-Wave, relés…).
</details>

<details><summary><b>¿Qué pasa si Home Assistant se reinicia en medio de un riego?</b></summary>

Al volver, el módulo detecta que el riego quedó interrumpido y **cierra todas las válvulas** por seguridad. El ciclo no se retoma automáticamente.
</details>

<details><summary><b>¿Y si un aspersor no está disponible?</b></summary>

Se saltea, queda registrado en el historial y la secuencia sigue con el siguiente.
</details>

<details><summary><b>¿Dos programas se pueden superponer?</b></summary>

No se pisan: el segundo **espera en cola** o se **omite**, según lo que elijas en el programa.
</details>

<details><summary><b>No veo "Riego" en la barra lateral</b></summary>

Asegurate de haber agregado la integración (paso 3 de la instalación) y recargá el navegador con Ctrl+F5. En la app móvil, cerrala y abrila de nuevo.
</details>

## 🛠️ Desarrollo

```bash
# Demo de la interfaz con backend simulado (no requiere Home Assistant)
python3 -m http.server 8765   # y abrí http://localhost:8765/dev/demo.html

# Tests: lógica pura + integración con un HA real (pytest-homeassistant-custom-component)
pip install pytest-homeassistant-custom-component
pytest tests
```

La pestaña Mapa incluye [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause) en `frontend/vendor/`. Imágenes satelitales: Esri World Imagery.

Estructura: `custom_components/sk_irrigation/` (motor, scheduler, API websocket, entidades), `frontend/` (panel web, sin compilación), `brand/` (íconos para HA 2026.3+), `tests/`, `dev/demo.html`.

Historial de versiones en [CHANGELOG.es.md](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/CHANGELOG.es.md).

## ☕ Apoyá el proyecto
Si SK Irrigation Manager te ahorra agua y tiempo, podés invitarme un café para que siga mejorándolo. ¡Gracias!

<p align="center"><a href="https://www.paypal.com/donate/?business=gerencia%40skynetcom.com.ar&currency_code=USD&item_name=SK+Irrigation+Manager"><img src="https://img.shields.io/badge/%E2%98%95%20Invitame%20un%20caf%C3%A9-PayPal-ffdd00?logo=paypal&logoColor=003087&labelColor=ffdd00&style=for-the-badge" alt="Invitame un café"></a></p>

## 📄 Licencia
[MIT](https://github.com/SkynetCom/sk-irrigation-manager-ha/blob/main/LICENSE) © SK / SkynetCom

