/**
 * INJER S.A.S. - Ingeniería & Topografía
 * Frontend Interactions & Interactive Project Calculator
 */

document.addEventListener('DOMContentLoaded', () => {
  // Numero de WhatsApp: lo define el panel de edicion (atributo data-wa del body)
  const WA_NUMBER = document.body.dataset.wa || '573205931159';

  // 1. Current Year in Footer
  const yearEl = document.getElementById('currentYear');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // 2. Dark / Light Theme Toggle
  const themeToggle = document.getElementById('themeToggle');
  const htmlRoot = document.documentElement;
  const currentTheme = localStorage.getItem('injer_theme') || 'light';
  
  htmlRoot.setAttribute('data-theme', currentTheme);
  updateThemeIcon(currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const activeTheme = htmlRoot.getAttribute('data-theme');
      const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
      htmlRoot.setAttribute('data-theme', newTheme);
      localStorage.setItem('injer_theme', newTheme);
      updateThemeIcon(newTheme);
    });
  }

  function updateThemeIcon(theme) {
    if (!themeToggle) return;
    const icon = themeToggle.querySelector('i');
    if (icon) {
      if (theme === 'dark') {
        icon.className = 'fa-solid fa-sun';
      } else {
        icon.className = 'fa-solid fa-moon';
      }
    }
  }

  // 3. Header Scroll Effect
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 30) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // 4. Mobile Menu Navigation
  const mobileToggle = document.getElementById('mobileToggle');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link');

  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      mobileToggle.setAttribute('aria-expanded', isOpen);
    });

    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // 5. Active Nav Link on Scroll
  const sections = document.querySelectorAll('section[id]');
  window.addEventListener('scroll', () => {
    const scrollY = window.pageYOffset;
    sections.forEach(current => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 120;
      const sectionId = current.getAttribute('id');
      const targetLink = document.querySelector(`.nav-link[href*="${sectionId}"]`);

      if (targetLink) {
        if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
          targetLink.classList.add('active');
        } else {
          targetLink.classList.remove('active');
        }
      }
    });
  });

  // 6. Interactive Calculator
  const calcService = document.getElementById('calcService');
  const calcLocation = document.getElementById('calcLocation');
  const calcSize = document.getElementById('calcSize');
  const rangeValue = document.getElementById('rangeValue');
  const calcTerrain = document.getElementById('calcTerrain');
  const chkCurvas = document.getElementById('chkCurvas');
  const chkOrtomosaico = document.getElementById('chkOrtomosaico');
  const chkCertificado = document.getElementById('chkCertificado');
  const chkInforme = document.getElementById('chkInforme');

  const calcPriceDisplay = document.getElementById('calcPriceDisplay');
  const summaryService = document.getElementById('summaryService');
  const summaryLocation = document.getElementById('summaryLocation');
  const btnSendQuoteWhatsapp = document.getElementById('btnSendQuoteWhatsapp');

  function calculateQuote() {
    if (!calcService || !calcSize || !calcTerrain) return;

    const selectedOption = calcService.options[calcService.selectedIndex];
    const baseRate = parseFloat(selectedOption.getAttribute('data-base')) || 500000;
    const serviceName = selectedOption.text.split('(')[0].trim();
    const size = parseInt(calcSize.value, 10);
    const terrainFactor = parseFloat(calcTerrain.value) || 1.0;

    // Update slider label
    let unitLabel = 'Hectáreas';
    if (calcService.value === 'topografia_urbana') {
      unitLabel = 'Lotes / ' + (size * 200) + ' m² aprox.';
    } else if (calcService.value === 'obra_civil') {
      unitLabel = 'Días / Jornadas de Replanteo';
    } else if (calcService.value === 'volumetria') {
      unitLabel = 'Puntos / ' + (size * 1000) + ' m³ aprox.';
    }
    rangeValue.textContent = `${size} ${unitLabel}`;

    // Incremental cost by size
    let variableRate = 0;
    if (size > 1) {
      if (calcService.value === 'dron') {
        variableRate = (size - 1) * 65000;
      } else if (calcService.value === 'topografia_rural') {
        variableRate = (size - 1) * 85000;
      } else if (calcService.value === 'topografia_urbana') {
        variableRate = (size - 1) * 120000;
      } else {
        variableRate = (size - 1) * 90000;
      }
    }

    // Extras
    let extrasCost = 0;
    if (chkCurvas && chkCurvas.checked) extrasCost += 100000;
    if (chkOrtomosaico && chkOrtomosaico.checked) extrasCost += 180000;
    if (chkCertificado && chkCertificado.checked) extrasCost += 250000;
    if (chkInforme && chkInforme.checked) extrasCost += 150000;

    // Subtotal with terrain multiplier
    const total = Math.round(((baseRate + variableRate) * terrainFactor) + extrasCost);

    // Format COP
    const formattedPrice = new Intl.NumberFormat('es-CO').format(total);
    calcPriceDisplay.textContent = formattedPrice;

    // Summary labels
    summaryService.textContent = serviceName;
    summaryLocation.textContent = calcLocation ? calcLocation.value : 'Valledupar';

    return {
      totalFormatted: formattedPrice,
      serviceName,
      location: calcLocation ? calcLocation.value : 'Valledupar',
      size,
      unitLabel,
      terrain: calcTerrain.options[calcTerrain.selectedIndex].text
    };
  }

  // Bind change events
  [calcService, calcLocation, calcSize, calcTerrain, chkCurvas, chkOrtomosaico, chkCertificado, chkInforme].forEach(el => {
    if (el) {
      el.addEventListener('input', calculateQuote);
      el.addEventListener('change', calculateQuote);
    }
  });

  // Calculate initial quote
  calculateQuote();

  // Send Quote to WhatsApp
  if (btnSendQuoteWhatsapp) {
    btnSendQuoteWhatsapp.addEventListener('click', () => {
      const quote = calculateQuote();
      const extras = [];
      if (chkCurvas && chkCurvas.checked) extras.push('Planos CAD + Curvas de Nivel');
      if (chkOrtomosaico && chkOrtomosaico.checked) extras.push('Ortomosaico Georreferenciado');
      if (chkCertificado && chkCertificado.checked) extras.push('Certificado IGAC');
      if (chkInforme && chkInforme.checked) extras.push('Informe Técnico');

      const message = `*SOLICITUD DE COTIZACIÓN - INJER S.A.S.*%0A%0A` +
        `📐 *Servicio:* ${encodeURIComponent(quote.serviceName)}%0A` +
        `📍 *Ubicación:* ${encodeURIComponent(quote.location)}%0A` +
        `📏 *Extensión:* ${encodeURIComponent(quote.size + ' ' + quote.unitLabel)}%0A` +
        `⛰️ *Topografía:* ${encodeURIComponent(quote.terrain)}%0A` +
        `📑 *Entregables:* ${encodeURIComponent(extras.join(', ') || 'Básicos')}%0A` +
        `💰 *Valor Estimado Referencial:* COP $${encodeURIComponent(quote.totalFormatted)}%0A%0A` +
        `Hola ingenieros, quisiera coordinar una visita técnica o validar la cotización definitiva.`;

      const whatsappUrl = `https://wa.me/${WA_NUMBER}?text=${message}`;
      window.open(whatsappUrl, '_blank');
    });
  }

  // 7. Contact Form Handling
  const contactForm = document.getElementById('contactForm');
  const formSuccessMessage = document.getElementById('formSuccessMessage');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('contactName').value.trim();
      const phone = document.getElementById('contactPhone').value.trim();
      const email = document.getElementById('contactEmail').value.trim();
      const service = document.getElementById('contactService').value;
      const message = document.getElementById('contactMessage').value.trim();

      if (!name || !phone || !message) {
        alert('Por favor completa todos los campos requeridos (*).');
        return;
      }

      // Display confirmation
      if (formSuccessMessage) {
        formSuccessMessage.style.display = 'flex';
      }

      // Open WhatsApp pre-filled with the message
      const text = `*CONTACTO WEB - INJER S.A.S.*%0A%0A` +
        `👤 *Nombre:* ${encodeURIComponent(name)}%0A` +
        `📞 *Teléfono:* ${encodeURIComponent(phone)}%0A` +
        `📧 *Correo:* ${encodeURIComponent(email || 'No especificado')}%0A` +
        `🛠️ *Servicio:* ${encodeURIComponent(service)}%0A` +
        `📝 *Detalles:* ${encodeURIComponent(message)}`;

      setTimeout(() => {
        const url = `https://wa.me/${WA_NUMBER}?text=${text}`;
        window.open(url, '_blank');
      }, 700);

      contactForm.reset();
    });
  }
});
