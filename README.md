# INJER S.A.S. — Ingeniería & Topografía

Sitio web oficial corporativo de **INJER S.A.S.**, empresa de ingeniería y topografía de precisión con sede en **Valledupar, Cesar, Colombia**.

[![Facebook Oficial](https://img.shields.io/badge/Facebook-INJER_SAS-1877F2?style=flat&logo=facebook)](https://www.facebook.com/profile.php?id=100066559567309)
[![WhatsApp Directo](https://img.shields.io/badge/WhatsApp-+57_320_593_1159-25D366?style=flat&logo=whatsapp)](https://wa.me/573205931159)
[![NIT](https://img.shields.io/badge/NIT-901191248--6-009639?style=flat)](file:///index.html)

---

## 🌟 Características Principales

* **Identidad Visual Corporativa:** Logotipo oficial de INJER S.A.S. destacado, paleta institucional verde esmeralda y grafito slate.
* **Diseño Dual (Light / Dark Mode):** Conmutador interactivo con persistencia local de la preferencia del usuario.
* **Calculadora / Cotizador Interactivo:** Estimación en tiempo real del presupuesto según tipo de trabajo, extensión en hectáreas/unidades y topografía del terreno, con generación de cotización formal enviada directamente a **WhatsApp**.
* **Portafolio de Servicios de Ingeniería:**
  * Topografía planialtimétrica y deslindes.
  * Fotogrametría aérea con drones (ortomosaicos y nubes de puntos 3D).
  * Control y replanteo de obras civiles e infraestructura vial.
  * Cálculo de volúmenes y movimiento de tierras.
  * Georreferenciación satelital vinculada a la red nacional MAGNA-SIRGAS.
* **Contacto Directo:**
  * Dirección: Mz. 3, Casa 15, Barrio Don Alberto, Valledupar - Cesar.
  * Teléfono / WhatsApp: [+57 320 593 1159](tel:+573205931159).
  * Enlace al perfil oficial de Facebook.

---

## 📁 Estructura del Proyecto

```text
├── public/                 # El sitio (diseño)
│   ├── index.html          # HTML marcado con data-edit / data-list (valores por defecto)
│   ├── styles.css, script.js
│   ├── assets/             # Fotos originales
│   └── _edit/              # Modo edición (editor.js, editor.css) — solo se usa en /admin
├── src/                    # Cloudflare Worker (worker, auth, page, api, login)
├── scripts/                # seed.mjs, hash-password.mjs, configurar-db.mjs, test.mjs
├── schema.sql              # Tablas D1: contenido, imagenes, listas, sesiones
├── wrangler.toml           # Configuración de Cloudflare
├── GUIA.md                 # Guía paso a paso (instalar, probar, publicar)
├── CLIENTE.md              # Instrucciones para el cliente
└── serve.js                # Servidor estático simple (sin panel; usa npm run dev para todo)
```

---

## 🚀 Panel de edición y despliegue

El sitio corre en **Cloudflare Workers + D1** (gratis, sin tarjeta). El cliente edita textos, fotos y listas entrando a `/admin`.

Todo el procedimiento (instalación, pruebas locales, secrets, despliegue y lista de pruebas) está en **[GUIA.md](GUIA.md)**. Lo que debe saber el cliente está en **[CLIENTE.md](CLIENTE.md)**.

Resumen: `npm install` → `npm run db:schema:local && npm run seed:local && npm run clave:dev` → `npm run dev`.

---

*Desarrollado para **INJER S.A.S.** • Valledupar, Cesar, Colombia.*
