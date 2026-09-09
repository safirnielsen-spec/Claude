/* ==========================================================================
   CORE PARTNERS — script.js
   ==========================================================================
   Ren vanilla JavaScript. Ingen frameworks, ingen libraries.
   Alt er organiseret som små, uafhængige moduler der initialiseres samlet
   fra bunden af filen. Hvert modul tjekker selv om dets markup findes på
   siden, så filen roligt kan genbruges uden fejl hvis en sektion fjernes.

   Indhold:
     01. Utils
     02. Loader
     03. Custom cursor
     04. Navigation (scroll-state, aktiv sektion, mobilmenu)
     05. Smooth scroll (anker-links med offset for fast nav)
     06. Scroll-reveal (IntersectionObserver på [data-reveal])
     07. Tekst-splitting (ord/bogstaver til span, til reveal + parallax)
     08. Statement parallax
     09. Horisontal scroll-sektion
     10. Count-up tal (statistikker)
     11. Cases parallax-baggrunde
     12. No Cure No Pay step-linje
     13. Beregner (live besparelsesberegning)
     14. Kontaktformular (mailto-baseret, kræver ingen backend)
     15. Init
   ========================================================================== */

(function(){
  'use strict';

  /* == 01. UTILS ========================================================= */

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function qs(sel, ctx){ return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx){ return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function lerp(a, b, t){ return a + (b - a) * t; }

  // Throttler til scroll/resize-handlers via requestAnimationFrame
  function raf(fn){
    var ticking = false;
    return function(){
      if(ticking) return;
      ticking = true;
      window.requestAnimationFrame(function(){ fn(); ticking = false; });
    };
  }

  var fmtDKK = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
  function kr(n){ return fmtDKK.format(Math.round(n)) + ' kr.'; }


  /* == 02. LOADER ========================================================= */

  function initLoader(){
    var loader = qs('.loader');
    if(!loader) return;
    document.body.classList.add('no-scroll');

    function finish(){
      loader.classList.add('is-done');
      document.body.classList.remove('no-scroll');
      var hero = qs('.hero');
      if(hero) hero.classList.add('is-ready');
      loader.addEventListener('transitionend', function(){ loader.remove(); }, { once: true });
    }

    // Minimum visningstid så animationen når at spille, uanset cache
    var minTime = new Promise(function(res){ setTimeout(res, prefersReducedMotion ? 200 : 1500); });
    var loaded = new Promise(function(res){
      if(document.readyState === 'complete') res();
      else window.addEventListener('load', res, { once: true });
    });
    Promise.all([minTime, loaded]).then(finish);
  }


  /* == 03. CUSTOM CURSOR ================================================== */

  function initCursor(){
    if(window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    var dot = document.createElement('div');
    dot.className = 'cursor-dot is-hidden';
    document.body.appendChild(dot);

    var x = 0, y = 0;
    document.addEventListener('mousemove', function(e){
      x = e.clientX; y = e.clientY;
      dot.classList.remove('is-hidden');
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    });
    document.addEventListener('mouseleave', function(){ dot.classList.add('is-hidden'); });

    var hoverSelector = 'a, button, .btn, input, select, textarea, [data-cursor-hover]';
    document.addEventListener('mouseover', function(e){
      if(e.target.closest && e.target.closest(hoverSelector)) dot.classList.add('is-hover');
    });
    document.addEventListener('mouseout', function(e){
      if(e.target.closest && e.target.closest(hoverSelector)) dot.classList.remove('is-hover');
    });
  }


  /* == 04. NAVIGATION ====================================================== */

  function initNav(){
    var nav = qs('.nav');
    if(!nav) return;

    // Sort baggrund efter et vist scroll-dyk
    var onScroll = raf(function(){
      nav.classList.toggle('is-scrolled', window.scrollY > 40);
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Mobilmenu
    var burger = qs('.nav-burger');
    var menu = qs('.mobile-menu');
    if(burger && menu){
      burger.addEventListener('click', function(){
        var open = !burger.classList.contains('is-open');
        burger.classList.toggle('is-open', open);
        menu.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('no-scroll', open);
      });
      qsa('a', menu).forEach(function(link){
        link.addEventListener('click', function(){
          burger.classList.remove('is-open');
          menu.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
          document.body.classList.remove('no-scroll');
        });
      });
    }

    // Aktiv sektion i navigationen
    var navLinks = qsa('.nav-links a[href^="#"]');
    var sections = navLinks
      .map(function(l){ return document.getElementById(l.getAttribute('href').slice(1)); })
      .filter(Boolean);
    if('IntersectionObserver' in window && sections.length){
      var activeObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          var link = navLinks.filter(function(l){ return l.getAttribute('href') === '#' + entry.target.id; })[0];
          if(!link) return;
          if(entry.isIntersecting) navLinks.forEach(function(l){ l.classList.remove('is-active'); }), link.classList.add('is-active');
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(function(s){ activeObserver.observe(s); });
    }
  }


  /* == 05. SMOOTH SCROLL =================================================== */

  function initSmoothScroll(){
    var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 88;
    qsa('a[href^="#"]').forEach(function(link){
      var id = link.getAttribute('href');
      if(id.length < 2) return;
      var target = document.getElementById(id.slice(1));
      if(!target) return;
      link.addEventListener('click', function(e){
        e.preventDefault();
        var top = target.getBoundingClientRect().top + window.scrollY - (navH - 8);
        window.scrollTo({ top: top, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      });
    });
  }


  /* == 06. SCROLL-REVEAL =================================================== */

  function initReveal(){
    var items = qsa('[data-reveal]');
    if(!items.length) return;

    items.forEach(function(el){
      var delay = el.getAttribute('data-delay');
      if(delay) el.style.setProperty('--reveal-delay', (parseInt(delay) * 90) + 'ms');
    });

    if(!('IntersectionObserver' in window) || prefersReducedMotion){
      items.forEach(function(el){ el.classList.add('is-visible'); });
      return;
    }
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function(el){ obs.observe(el); });
  }


  /* == 07. TEKST-SPLITTING ================================================= */

  // Splitter tekstindholdet af et element i <span>-ord, og sætter --i så
  // CSS kan forsinke hvert ord (bruges af .text-reveal og statement-parallax).
  function splitWords(el, extraClass){
    var text = el.textContent.trim();
    el.textContent = '';
    text.split(/\s+/).forEach(function(word, i){
      var span = document.createElement('span');
      span.className = 'word' + (extraClass ? ' ' + extraClass : '');
      span.style.setProperty('--i', i);
      span.textContent = word;
      el.appendChild(span);
      el.appendChild(document.createTextNode(' '));
    });
  }

  function initTextSplit(){
    qsa('.text-reveal').forEach(function(el){ splitWords(el); });
  }


  /* == 08. STATEMENT PARALLAX =============================================== */

  function initStatement(){
    var statement = qs('.statement');
    var text = qs('.statement-text');
    if(!statement || !text) return;

    splitWords(text);
    var words = qsa('.word', text);
    // Skift farve på nøgleordet "penge" hvis det findes
    words.forEach(function(w){
      if(/penge/i.test(w.textContent)) w.classList.add('hl');
    });

    if(prefersReducedMotion) return;

    var onScroll = raf(function(){
      var rect = statement.getBoundingClientRect();
      var vh = window.innerHeight;
      // progress: -1 (sektion under viewport) .. 0 (centreret) .. 1 (sektion over viewport)
      var progress = clamp((vh - rect.top) / (vh + rect.height), 0, 1) * 2 - 1;
      words.forEach(function(w, i){
        var factor = ((i % 5) - 2) * 10; // hvert ord bevæger sig forskelligt
        w.style.transform = 'translateY(' + (progress * factor) + 'px)';
      });
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }


  /* == 09. HORISONTAL SCROLL ================================================ */

  function initHscroll(){
    var wrap = qs('.hscroll');
    var sticky = qs('.hscroll-sticky');
    var track = qs('.hscroll-track');
    var panels = qsa('.hscroll-panel', track);
    var dots = qsa('.hscroll-progress i');
    if(!wrap || !sticky || !track || !panels.length) return;

    // Wrapperen skal være N gange skærmhøjden, så vertikal scroll giver plads
    // til at "spole" horisontalt igennem panelerne, imens sektionen er sticky.
    function setHeight(){
      wrap.style.height = (panels.length * 100) + 'vh';
    }
    setHeight();

    var maxTranslate = 0;
    function measure(){
      maxTranslate = track.scrollWidth - window.innerWidth;
    }
    measure();

    var onScroll = raf(function(){
      var rect = wrap.getBoundingClientRect();
      var total = wrap.offsetHeight - window.innerHeight;
      var progress = clamp(-rect.top / total, 0, 1);
      var x = progress * maxTranslate;
      track.style.transform = 'translateX(-' + x + 'px)';

      var activeIndex = clamp(Math.round(progress * (panels.length - 1)), 0, panels.length - 1);
      panels.forEach(function(p, i){ p.classList.toggle('is-active', i === activeIndex); });
      dots.forEach(function(d, i){ d.classList.toggle('is-active', i === activeIndex); });
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', raf(function(){ setHeight(); measure(); onScroll(); }));
    onScroll();
  }


  /* == 10. COUNT-UP ========================================================= */

  function animateCount(el){
    var target = parseFloat(el.getAttribute('data-count-to'));
    var suffix = el.getAttribute('data-count-suffix') || '';
    var prefix = el.getAttribute('data-count-prefix') || '';
    var decimals = parseInt(el.getAttribute('data-count-decimals') || '0');
    if(isNaN(target)) return;

    if(prefersReducedMotion){
      el.textContent = prefix + target.toFixed(decimals).replace('.', ',') + suffix;
      return;
    }

    var duration = 1600, start = null;
    function step(ts){
      if(!start) start = ts;
      var p = clamp((ts - start) / duration, 0, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = prefix + val.toFixed(decimals).replace('.', ',') + suffix;
      if(p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function initCounters(){
    var counters = qsa('[data-count-to]');
    if(!counters.length) return;
    if(!('IntersectionObserver' in window)){
      counters.forEach(animateCount);
      return;
    }
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          animateCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function(c){ obs.observe(c); });
  }


  /* == 11. CASES PARALLAX ==================================================== */

  function initCases(){
    var cases = qsa('.case');
    if(!cases.length || prefersReducedMotion) return;

    var onScroll = raf(function(){
      cases.forEach(function(c){
        var bg = qs('.case-bg', c);
        if(!bg) return;
        var rect = c.getBoundingClientRect();
        var vh = window.innerHeight;
        if(rect.bottom < 0 || rect.top > vh) return;
        var progress = (rect.top) / vh; // -1..1 cirka
        bg.style.transform = 'translateY(' + (progress * 60) + 'px) scale(1.08)';
      });
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }


  /* == 12. NO CURE NO PAY STEP-LINJE ========================================== */

  function initNcnp(){
    var steps = qs('.ncnp-steps');
    if(!steps) return;
    qsa('.ncnp-step-num', steps).forEach(function(el, i){ el.style.setProperty('--i', i); });

    if(!('IntersectionObserver' in window) || prefersReducedMotion){
      steps.classList.add('is-visible');
      return;
    }
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){ steps.classList.add('is-visible'); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.4 });
    obs.observe(steps);
  }


  /* == 13. BEREGNER ========================================================== */

  function initCalculator(){
    var form = qs('#calcForm');
    if(!form) return;

    var els = {
      insurance: qs('#insurance'),
      service: qs('#service'),
      facility: qs('#facility'),
      drift: qs('#drift'),
      other: qs('#other'),
      orgType: qs('#orgType'),
      lastReview: qs('#lastReview'),
      hasBuying: qs('#hasBuying'),
      showPropertyValue: qs('#showPropertyValue'),
      resultAmount: qs('#resultAmount'),
      resultCopy: qs('#resultCopy'),
      totalCost: qs('#totalCost'),
      savingPct: qs('#savingPct'),
      feeAmount: qs('#feeAmount'),
      netAmount: qs('#netAmount'),
      propValueLine: qs('#propValueLine'),
      propValue: qs('#propValue'),
      donutFill: qs('#donutFill'),
      donutLabel: qs('#donutLabel'),
      barBeforeFill: qs('#barBeforeFill'),
      barBeforeVal: qs('#barBeforeVal'),
      barAfterFill: qs('#barAfterFill'),
      barAfterVal: qs('#barAfterVal')
    };

    var numberInputs = [els.insurance, els.service, els.facility, els.drift, els.other].filter(Boolean);

    // Tusind-separator mens man skriver
    function formatThousands(v){
      var digits = v.replace(/\./g, '').replace(/[^\d]/g, '');
      if(!digits) return '';
      return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    numberInputs.forEach(function(input){
      input.addEventListener('input', function(){
        var pos = input.selectionStart, oldLen = input.value.length;
        input.value = formatThousands(input.value);
        var diff = input.value.length - oldLen;
        try{ input.setSelectionRange(pos + diff, pos + diff); }catch(e){}
        scheduleCalculate();
      });
    });
    [els.orgType, els.lastReview, els.hasBuying, els.showPropertyValue].filter(Boolean).forEach(function(el){
      el.addEventListener('change', scheduleCalculate);
    });

    var calcTimer = null;
    function scheduleCalculate(){
      clearTimeout(calcTimer);
      calcTimer = setTimeout(calculate, 250);
    }

    function parseNum(v){ return Math.max(0, Number((v || '0').replace(/\./g, '').replace(/[^\d]/g, '')) || 0); }

    // Kategori-vægte: hvor meget potentiale ligger typisk i hver omkostningstype.
    // Baseret på erfaring fra gennemførte sager — bruges kun til et vejledende estimat.
    var WEIGHTS = { insurance: .18, service: .13, facility: .11, drift: .09, other: .07 };
    var FEE_RATE = .2;
    var YIELD_RATE = .045;

    var DONUT_R = 54;
    var DONUT_CIRC = 2 * Math.PI * DONUT_R;
    if(els.donutFill) els.donutFill.style.strokeDasharray = DONUT_CIRC.toFixed(1);

    function calculate(){
      var vals = {
        insurance: parseNum(els.insurance.value),
        service: parseNum(els.service.value),
        facility: parseNum(els.facility.value),
        drift: parseNum(els.drift.value),
        other: parseNum(els.other.value)
      };
      var total = vals.insurance + vals.service + vals.facility + vals.drift + vals.other;

      if(!total){
        if(els.resultAmount) els.resultAmount.textContent = '0 kr.';
        if(els.resultCopy) els.resultCopy.textContent = 'Udfyld felterne til venstre for at se jeres potentiale.';
        return;
      }

      var reviewRate = parseFloat(els.lastReview ? els.lastReview.value : '.12') || .12;
      var buyingAdj = parseFloat(els.hasBuying ? els.hasBuying.value : '.02') || 0;

      var weighted = 0;
      Object.keys(WEIGHTS).forEach(function(key){ weighted += vals[key] * WEIGHTS[key]; });
      var blendedRate = clamp((weighted / total) + (reviewRate - .12) + buyingAdj, .04, .3);

      var low = Math.round(total * Math.max(.03, blendedRate - .04));
      var high = Math.round(total * blendedRate);
      var mid = Math.round((low + high) / 2);
      var fee = Math.round(mid * FEE_RATE);
      var net = mid - fee;

      if(els.resultAmount) els.resultAmount.textContent = kr(low) + ' – ' + kr(high);
      if(els.resultCopy){
        var org = (els.orgType ? els.orgType.value : 'jeres organisation').toLowerCase();
        els.resultCopy.textContent = 'Baseret på ' + org + ' med jeres nuværende omkostningsbillede og forhandlingshistorik.';
      }
      if(els.totalCost) els.totalCost.textContent = kr(total);
      if(els.savingPct) els.savingPct.textContent = Math.round(low / total * 100) + '–' + Math.round(high / total * 100) + '%';
      if(els.feeAmount) els.feeAmount.textContent = kr(fee);
      if(els.netAmount) els.netAmount.textContent = kr(net);

      if(els.propValueLine && els.propValue){
        var show = els.showPropertyValue && els.showPropertyValue.checked;
        els.propValueLine.style.display = show ? 'flex' : 'none';
        if(show) els.propValue.textContent = kr(low / YIELD_RATE) + ' – ' + kr(high / YIELD_RATE);
      }

      // Donut: andel af samlede omkostninger der udgør det estimerede potentiale
      if(els.donutFill && els.donutLabel){
        var share = clamp(mid / total, 0, 1);
        var offset = DONUT_CIRC * (1 - share);
        els.donutFill.style.strokeDashoffset = offset.toFixed(1);
        els.donutLabel.textContent = Math.round(share * 100) + '%';
      }

      // Barchart: nuværende omkostning vs. optimeret omkostning
      if(els.barBeforeFill && els.barAfterFill){
        els.barBeforeFill.style.width = '100%';
        els.barBeforeVal.textContent = kr(total);
        var afterPct = clamp((total - mid) / total * 100, 8, 100);
        els.barAfterFill.style.width = afterPct + '%';
        els.barAfterVal.textContent = kr(total - mid);
      }
    }

    var fillBtn = qs('#fillExample');
    if(fillBtn){
      fillBtn.addEventListener('click', function(){
        els.insurance.value = '280.000';
        els.service.value = '420.000';
        els.facility.value = '350.000';
        els.drift.value = '260.000';
        els.other.value = '90.000';
        calculate();
      });
    }

    form.addEventListener('submit', function(e){ e.preventDefault(); calculate(); });
  }


  /* == 14. KONTAKTFORMULAR =================================================== */

  function initContactForm(){
    var form = qs('#contactForm');
    if(!form) return;
    var success = qs('.form-success', form.parentElement) || qs('#formSuccess');

    form.addEventListener('submit', function(e){
      e.preventDefault();
      var data = new FormData(form);
      var name = (data.get('name') || '').toString();
      var email = (data.get('email') || '').toString();
      var phone = (data.get('phone') || '').toString();
      var message = (data.get('message') || '').toString();

      if(!name || !email){
        form.reportValidity && form.reportValidity();
        return;
      }

      // Statisk hosting uden backend: åbner brugerens mail-klient med udfyldt
      // besked. Skal der logges leads server-side i stedet, erstat denne
      // blok med et fetch-kald til jeres formular-endpoint (fx Formspree
      // eller et lille PHP-script på Simply Hosting).
      var subject = encodeURIComponent('Gratis driftsgennemgang — ' + name);
      var body = encodeURIComponent(
        'Navn: ' + name + '\n' +
        'Email: ' + email + '\n' +
        'Telefon: ' + phone + '\n\n' +
        message
      );
      window.location.href = 'mailto:kontakt@corepartners.dk?subject=' + subject + '&body=' + body;

      form.classList.add('is-sent');
      if(success) success.classList.add('is-visible');
    });
  }


  /* == 15. INIT ============================================================== */

  document.addEventListener('DOMContentLoaded', function(){
    initLoader();
    initCursor();
    initNav();
    initSmoothScroll();
    initTextSplit();
    initReveal();
    initStatement();
    initHscroll();
    initCounters();
    initCases();
    initNcnp();
    initCalculator();
    initContactForm();
  });

})();
