# Guía paso a paso: sitio de INJER con panel de edición

Todo corre en Cloudflare: un **Worker** (el servidor) y una base **D1** (los textos, listas y fotos). No usa WordPress, Supabase, R2 ni nada que pida tarjeta: el plan gratis de Cloudflare alcanza.

Los comandos se escriben en una terminal (PowerShell o la de VS Code) **dentro de la carpeta del proyecto**.

---

## 0. Cómo funciona (1 minuto)

| Qué | Dónde vive |
|---|---|
| El diseño (HTML, CSS, JS) | carpeta `public/` |
| Textos editados, listas, enlaces | tabla `contenido` y `listas` de D1 |
| Fotos subidas por el cliente | tabla `imagenes` de D1 (se sirven en `/img/ID`) |
| Contraseña y sesiones | secrets de Wrangler + tabla `sesiones` |
| El servidor | `src/worker.js` (+ `auth.js`, `page.js`, `api.js`, `login.js`) |
| El modo edición | `public/_edit/editor.js` y `editor.css` |

Cuando alguien abre la página, el Worker toma `public/index.html`, le pone el contenido de D1 y responde. Por eso Google ve los textos reales y no hay parpadeo. El cliente entra a `/admin`, inicia sesión y ve **la misma página** con los textos editables.

---

## 1. Requisitos (una sola vez)

1. **Node.js 18 o superior** → https://nodejs.org (versión LTS). Comprueba con:
   ```
   node -v
   ```
2. Una **cuenta gratuita de Cloudflare** → https://dash.cloudflare.com/sign-up (no pide tarjeta).

Instala las dependencias del proyecto:

```
npm install
```

---

## 2. Probarlo en tu computador (recomendado antes de publicar)

```
npx wrangler login
```
(se abre el navegador; pulsa **Allow**. Solo hace falta para publicar, pero conviene hacerlo ya.)

Prepara la base **local** y la contraseña de prueba:

```
npm run db:schema:local
npm run seed:local
npm run clave:dev
```

- `db:schema:local` crea las 4 tablas.
- `seed:local` carga en la base el contenido actual de la página (textos y listas).
- `clave:dev` te pide una contraseña (mínimo 10 caracteres, no se ve mientras escribes), la convierte en hash y crea el archivo `.dev.vars` (ya está en `.gitignore`: no se sube a git).

Arranca el servidor local:

```
npm run dev
```

Abre:

- http://localhost:8787 → la página pública
- http://localhost:8787/admin → el panel (usa la contraseña que acabas de crear)

> Si el navegador no guarda la sesión en `localhost`, usa Chrome o Edge (aceptan cookies `Secure` en localhost).

### Prueba automática (opcional)

Con `npm run dev` corriendo, en **otra** terminal:

```
$env:TEST_PASSWORD="la-contraseña-que-pusiste"; npm test
```
(En Git Bash: `TEST_PASSWORD="la-contraseña" npm test`.) Hace ~60 comprobaciones (login, bloqueo, editar texto, fotos, listas, seguridad) y deja la base como estaba.

---

## 3. Publicar en Cloudflare

### 3.1 Iniciar sesión (si no lo hiciste)

```
npx wrangler login
```

### 3.2 Crear la base de datos

```
npm run db:configurar
```

Crea la base `injer-db` en tu cuenta y escribe su `database_id` en `wrangler.toml` automáticamente. Si ya existía, solo copia el id.

### 3.3 Crear las tablas y cargar el contenido actual

```
npm run db:schema
npm run seed
```

(Si te pregunta "ok to proceed?", escribe `y`.) `seed` es seguro de repetir: **no pisa** lo que el cliente ya editó.

### 3.4 Publicar el sitio

```
npm run deploy
```

La primera vez Cloudflare te pide elegir un subdominio `workers.dev` (gratis). Al terminar muestra la dirección, algo como:

```
https://injer-web.TU-USUARIO.workers.dev
```

### 3.5 Poner la contraseña y el secreto de sesión (secrets)

Genera el hash de la contraseña del cliente:

```
npm run clave
```

Escribe la contraseña (mínimo 10 caracteres) dos veces. Te imprime una línea que empieza con `pbkdf2-sha256$100000$...`. **Cópiala completa** y guárdala:

```
npx wrangler secret put ADMIN_PASSWORD_HASH
```
→ pega esa línea cuando lo pida y pulsa Enter.

Genera un secreto de sesión aleatorio y guárdalo:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put SESSION_SECRET
```
→ pega el texto largo que imprimió el primer comando.

Los secrets **no están en el código ni en git**; viven cifrados en Cloudflare.

### 3.6 Probar en producción

1. Abre `https://injer-web.TU-USUARIO.workers.dev/admin`.
2. Entra con la contraseña.
3. Cambia un texto, pulsa **Guardar** y abre la página pública en otra pestaña (o en modo incógnito): el cambio debe verse.

### 3.7 Usar el dominio propio (opcional)

Cloudflare → **Workers & Pages** → `injer-web` → **Settings → Domains & Routes → Add → Custom domain**. El dominio debe estar en Cloudflare (DNS gratis).

---

## 4. Comandos del día a día

| Quiero… | Comando |
|---|---|
| Ver el sitio en mi computador | `npm run dev` |
| Publicar cambios de diseño (HTML/CSS/JS) | `npm run deploy` |
| Cambiar la contraseña del cliente | `npm run clave` y luego `npx wrangler secret put ADMIN_PASSWORD_HASH` |
| Cerrar todas las sesiones abiertas | `npx wrangler secret put SESSION_SECRET` (con un valor nuevo) |
| Ver los textos guardados | `npx wrangler d1 execute injer-db --remote --command "SELECT * FROM contenido"` |
| Volver a la página original (borra lo editado) | `npx wrangler d1 execute injer-db --remote --command "DELETE FROM contenido; DELETE FROM listas; DELETE FROM imagenes"` y luego `npm run seed` |

> **Importante:** `npm run deploy` actualiza el diseño pero **no** toca el contenido que el cliente editó (vive en D1).

---

## 5. Cómo está marcado el HTML (para cambiar el diseño sin romper la edición)

Todo está en `public/index.html`. El texto que ves ahí es el valor **por defecto**.

| Atributo | Para qué | Ejemplo |
|---|---|---|
| `data-edit="clave"` | texto editable (texto plano) | `<h2 data-edit="servicios_titulo">…</h2>` |
| `data-edit="clave" data-multiline` | texto con saltos de línea | dirección, horarios |
| `data-edit-img="clave"` | foto editable (si repites la clave, cambian todas: logo) | `<img data-edit-img="foto_drone">` |
| `data-edit-bg="clave"` | foto de fondo editable | `<section data-edit-bg="hero_fondo">` |
| `data-link="telefono" / "whatsapp" / "facebook"` | enlace que sigue lo que el cliente ponga en **Ajustes** | `<a data-link="whatsapp">` |
| `data-list="nombre"` | lista que crece | `<div data-list="servicios">` |

Dentro de una lista:

- `<template data-tpl>` = **la plantilla de cada elemento** (va como primer hijo del contenedor).
- Los elementos reales llevan `data-item` y son el valor por defecto.
- Campos de cada elemento: `data-field="titulo"` (texto), `data-field-img="foto"` (foto), `data-field-class="icono"` (clase del icono, se copia al duplicar), `data-field-lines="puntos"` (viñetas, una por línea).
- En la plantilla se usan marcadores: `{{titulo}}` (texto), `{{foto|img}}` (foto), `{{titulo|url}}` (para enlaces), `{{@wa}}` (WhatsApp) y `{{#lines puntos}}<li>{{.}}</li>{{/lines}}`.

**Para agregar un texto nuevo editable:** ponle `data-edit="una_clave_nueva"` y publica (`npm run deploy`). No necesitas tocar nada más; el servidor lee las claves permitidas del propio HTML.
**Para agregar una lista nueva:** copia el patrón de una existente (plantilla + elementos con `data-item`), publica y ejecuta `npm run seed` una vez para cargar sus valores iniciales.

Listas que existen hoy: `hero_stats`, `nosotros_features`, `servicios`, `tecnologia`, `galeria`, `porque`, `footer_servicios`. (La página no tiene preguntas frecuentes ni testimonios; si algún día los agregas, se hacen con una lista nueva como se explica arriba.)

---

## 6. Seguridad (qué está protegido y cómo)

- **Contraseña:** hash PBKDF2-SHA256 (100 000 iteraciones, sal aleatoria) con WebCrypto; nunca se guarda en claro.
- **Sesión:** cookie `HttpOnly; Secure; SameSite=Strict` (24 h). En la base solo se guarda un HMAC del token.
- **Intentos fallidos:** 5 por IP cada 15 minutos; luego se bloquea ese tiempo.
- **Escritura:** `/api/guardar` y `/api/img` exigen sesión y comprueban el `Origin`.
- **XSS:** todo texto del cliente se inserta como texto plano (se escapa); el editor pega solo texto plano.
- **Fotos:** solo WebP/JPEG/PNG (se verifica el contenido real, no solo el tipo), máximo 500 KB en el servidor (el navegador las comprime a <200 KB). SVG no se acepta.
- **Fotos huérfanas:** al guardar se borran las fotos viejas que ya nadie usa (con más de 1 hora).

---

## 7. Problemas frecuentes

**"El servidor no está configurado: faltan los secrets"** → falta el paso 3.5 (o en local, `npm run clave:dev`).

**El login da "Error 1102" / "Worker exceeded resource limits" (plan gratis)** → el hash tarda demasiado en calcularse. Genera uno más liviano y vuelve a subirlo:
```
$env:ITERACIONES="30000"; npm run clave
npx wrangler secret put ADMIN_PASSWORD_HASH
```
(Git Bash: `ITERACIONES=30000 npm run clave`.) El Worker lee las iteraciones del propio hash. Pasar al plan de pago de Workers también lo resuelve.

**"Esta lista aún no está cargada en la base de datos"** (aviso en el editor) → falta `npm run seed` (o `seed:local`).

**`npm run db:configurar` falla** → casi siempre falta `npx wrangler login`.

**Un cambio de diseño no se ve** → ejecuta `npm run deploy` y recarga con Ctrl+F5.

**Quiero empezar de cero en local** → borra la carpeta `.wrangler` y repite el paso 2.

---

## 8. Lista de pruebas (y cómo verificarlas)

`npm test` automatiza las de servidor; las marcadas 🖱 se prueban a mano en el navegador.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | 🖱 `/admin`, contraseña incorrecta | mensaje "Contraseña incorrecta. Te quedan N intentos" |
| 2 | 5 intentos incorrectos seguidos | "Demasiados intentos… espera 15 minutos"; ni la correcta entra |
| 3 | 🖱 `/admin`, contraseña correcta | aparece la página con los textos con borde punteado y la barra inferior |
| 4 | 🖱 Tocar un texto, escribir, **Guardar** | aviso verde "Cambios guardados" |
| 5 | Recargar la página **sin sesión** (incógnito) | el texto nuevo se ve |
| 6 | 🖱 **Cambiar foto** en una imagen y Guardar | la foto cambia, pesa <200 KB, y se ve sin sesión |
| 7 | 🖱 **Agregar elemento** en Servicios, editarlo, Guardar | aparece una tarjeta nueva al final |
| 8 | 🖱 ▲ / ▼ en un elemento, Guardar | el orden cambia y se mantiene al recargar |
| 9 | 🖱 🗑 en un elemento, Guardar | desaparece |
| 10 | Pegar `<script>alert(1)</script>` en un texto | se muestra como texto, no se ejecuta |
| 11 | Llamar a `/api/guardar` sin sesión | respuesta 401 |
| 12 | 🖱 Celular: abrir `/admin` | la barra inferior se ve, los botones se tocan fácil |
