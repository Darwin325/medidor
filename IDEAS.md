# Ideas para el Medidor de Terrenos GPS

Lista de mejoras propuestas, dividida en **Diseño** y **Funcionalidad**.

## 🎨 Diseño (10)
1. **Modo oscuro** con toggle y persistencia de preferencia en localStorage.
2. **Bottom-sheet en vez de modales** para Guardar/Compartir (patrón nativo móvil, sube desde abajo).
3. **Vértices numerados** (badges 1, 2, 3…) sobre cada marcador del polígono.
4. **Animación de pulso** en el marcador GPS actual y círculo de exactitud más pulido/translúcido.
5. **Auto-colapsar el panel** automáticamente mientras el rastreo "Caminando" está activo.
6. **Color por terreno** guardado (asignar un color al polígono y a su item en el historial).
7. **Retroalimentación háptica** (`navigator.vibrate`) al marcar punto, guardar y compartir.
8. **Lista lateral de vértices** con coordenadas visibles y editables (tocar para ir al punto).
9. **Indicador visual de calidad GPS** (barras verdes/ámbar/rojas según `accuracy`).
10. **Micro-interacciones**: estado "pressed" en botones, splash de carga y transiciones suaves.

## ⚙️ Funcionalidad (10)
1. **Editar puntos arrastrándolos** directamente en el mapa (mover vértices).
2. **Exportar a KML / GPX / CSV / GeoJSON** para usar en Google Earth, QGIS, Excel.
3. **Importar terrenos** desde archivo (KML o CSV) de vuelta al mapa.
4. **Vista de capas**: ver varios terrenos guardados superpuestos a la vez.
5. **Herramienta de distancia puntual** (medir tramo entre 2 toques, aparte del polígono).
6. **Deshacer/Rehacer múltiple** (pila completa, no solo el último punto).
7. **Autoguardado de borrador** y recuperación si cierras la app sin guardar.
8. **Adjuntar fotos y notas** a cada terreno (IndexedDB para imágenes).
9. **Búsqueda por dirección / geocodificación** (Nominatim) para centrar el mapa.
10. **Compartir como imagen** (captura PNG del mapa + datos) — *pospuesto*.

## Estado de implementación
- Funcionalidad 1, 2, 3, 4, 5, 6, 7, 8, 9: ✅ implementadas.
- Funcionalidad 10 (imagen): ⏸ pospuesta (requiere librería externa + CORS de tiles).
- Diseño (1-10): ⏳ pendiente.
