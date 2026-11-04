# Md Reader para Chrome

Bionic, lectura rápida y lectura de Markdown de Md Editor, en cualquier página.

## Qué hace

- **Bionic** (`⌥⇧B`): resalta el comienzo de cada palabra en la página y se puede deshacer por completo. No modifica código, campos de formulario ni zonas editables. También procesa el contenido que se carga después (scroll infinito, SPAs). Admite cualquier alfabeto.
- **Lectura rápida** (`⌥⇧R`): muestra una palabra cada vez con su punto de fijación. Si hay texto seleccionado, lee la selección; si no, detecta el texto principal de la página y omite menús, barras laterales y pies.
  - Hace pausas más largas en los puntos, las comas y los cambios de párrafo, y algo más largas en las palabras largas.
  - Teclas: `Espacio` lee o pausa, `←/→` va palabra a palabra, `⇧←/⇧→` va frase a frase, `↑/↓` cambia la velocidad, `[ ]` cambia el tamaño, `Inicio/Fin` y `Esc` cierra.
  - Cuando está en pausa muestra la frase entera para no perder el contexto. Guarda la velocidad y el tamaño.
- **Visor de Markdown**: abre los archivos `.md` de la web o de `file://` como una página de lectura limpia y saneada con DOMPurify. Incluye los botones Bionic, Lectura rápida y Fuente, y muestra `==resaltado==` y `++subrayado++` igual que la app.
- **Menú contextual**: "Lectura rápida de la selección", "Lectura rápida de esta página" y "Alternar lectura biónica".
- **Popup**: ajusta el resalte, el grosor y la longitud mínima de palabra con vista previa en directo, además de la velocidad, el tamaño y el tema (auto, claro u oscuro). También permite activar Bionic siempre en un sitio. Los ajustes se sincronizan con tu cuenta de Chrome.

## Instalar (modo desarrollador)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige esta carpeta `chrome-extension/`.
4. Para leer archivos `.md` locales, entra en **Detalles** de Md Reader y activa **Permitir acceso a URLs de archivo**.
5. Fija el icono en la barra de Chrome. Los atajos se cambian en `chrome://extensions/shortcuts`.

Al cambiar el código, pulsa el botón de recargar de la tarjeta en `chrome://extensions`.

## Publicar en Chrome Web Store

`npm run build:extension` genera `dist-extension/md-reader-<versión>.zip`. Ese zip se sube en el [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Hace falta una cuenta de desarrollador (pago único de 5 USD), capturas de pantalla, una política de privacidad (la extensión no envía datos fuera del navegador) y pasar la revisión de Google.

## Pruebas

```bash
npx vitest run tests/unit/chromeExtension.test.ts
npm run test:extension
```

La segunda orden carga la extensión real en Chromium y prueba Bionic, Lectura rápida, el visor de `.md`, el popup y la reinyección.
