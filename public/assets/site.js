(function () {
  // sticky nav border
  var nav = document.getElementById('nav');
  var onScroll = function () { nav.classList.toggle('stuck', window.scrollY > 8); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // scroll reveal
  var items = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i, 4) * 70) + 'ms';
      io.observe(el);
    });
  }

  // current year
  document.getElementById('yr').textContent = new Date().getFullYear();

  // ---- mobile drawer ----
  var burger = document.getElementById('burger');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  scrim.removeAttribute('hidden');

  // publish the real nav height so the drawer sits flush beneath it
  var setNavH = function () {
    document.documentElement.style.setProperty('--navh', nav.offsetHeight + 'px');
  };
  setNavH();
  window.addEventListener('resize', setNavH);
  window.addEventListener('orientationchange', function () { setTimeout(setNavH, 120); });

  var setMenu = function (open) {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    document.body.classList.toggle('locked', open);
  };

  burger.addEventListener('click', function () {
    setMenu(burger.getAttribute('aria-expanded') !== 'true');
  });

  // any tap inside the drawer closes it; in-page links get to scroll first
  drawer.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });

  scrim.addEventListener('click', function () { setMenu(false); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
  });

  // close when the viewport grows back past the mobile breakpoint
  var mq = window.matchMedia('(min-width: 901px)');
  var onMQ = function (e) { if (e.matches) setMenu(false); };
  mq.addEventListener ? mq.addEventListener('change', onMQ) : mq.addListener(onMQ);
})();
