// The DOM HUD: health, ammo, money, timer, score, alive counts, crosshair, hit
// marker, kill feed, radio callouts, banner, buy menu and overlays. It never
// touches the simulation; sim.js pushes numbers in and reads callbacks out.
// All values are cached so the DOM is only written when something changes.
export function createHud(callbacks) {
  // Screenshot staging (?shot=...) freezes the frame for a capture that can take
  // seconds on a slow renderer, so staged HUD dressing must not expire on the
  // normal gameplay timers while the camera is still exposing.
  const SHOT_MODE = new URLSearchParams(window.location.search).has('shot');
  const linger = (ms) => (SHOT_MODE ? Math.max(ms, 600000) : ms);
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    healthFill: $('health-fill'), healthNum: $('health-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), score: $('score'),
    aliveV: $('alive-v'), aliveJ: $('alive-j'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    feed: $('feed'), banner: $('banner'), bannerText: $('banner-text'),
    buy: $('buy'), buyList: $('buy-list'), buyClose: $('buy-close'), buyMoney: $('buy-money'),
    plantBar: $('plant-bar'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
    vignette: $('vignette'), hint: $('hint'), grenades: $('grenades'), scope: $('scope'),
    flash: $('flash'),
  };
  const cache = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      el.textContent = value;
    }
  }

  const COPY = {
    start: {
      title: 'DUSTLINE YARD',
      copy: '5v5 round-based tactical FPS at golden hour. Plant the spike at site A or B, or eliminate the Jackals. First to 5 rounds takes the yard.',
      action: 'Deploy',
    },
    paused: { title: 'DUSTLINE YARD', copy: 'Paused. Click to resume.', action: 'Resume' },
    dead: { title: 'You are down', copy: 'The round is lost. Your squad regroups for the next one.', action: 'Next round' },
    matchWin: { title: 'YARD TAKEN', copy: 'Vanguard wins the match. The yard is yours.', action: 'Play again' },
    matchLose: { title: 'YARD LOST', copy: 'The Jackals hold the yard this time.', action: 'Play again' },
  };

  return {
    setHealth(hp) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (cache.hpPct !== pct) {
        cache.hpPct = pct;
        els.healthFill.style.width = pct + '%';
        els.healthFill.classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve, name, utility) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', '/ ' + reserve);
      setText(els.weaponName, 'wname', name);
      setText(els.grenades, 'nades', 'FRAG ' + utility.frag + ' · FLASH ' + utility.flash + ' · SMOKE ' + utility.smoke);
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(money) { setText(els.money, 'money', '$' + money); },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const label = phase === 'buy' ? 'BUY ' : phase === 'planted' ? 'SPIKE ' : '';
      setText(els.timer, 'timer', label + String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'));
      els.timer.classList.toggle('urgent', s <= 10 && (phase === 'live' || phase === 'planted'));
    },
    setScore(wins, losses, round) {
      setText(els.score, 'score', 'VANGUARD ' + wins + ' — ' + losses + ' JACKALS · ROUND ' + round);
    },
    setAlive(v, j) {
      setText(els.aliveV, 'av', 'VANGUARD ' + v);
      setText(els.aliveJ, 'aj', 'JACKALS ' + j);
    },
    setCrosshair(spreadPx) {
      const v = Math.round(spreadPx);
      if (cache.spread !== v) {
        cache.spread = v;
        els.crosshair.style.setProperty('--gap', v + 'px');
      }
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), linger(holdMs));
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
      setTimeout(() => { if (line.parentNode) line.remove(); }, linger(6000));
    },
    // A team-plan radio callout: the speaker's name in the team teal, then
    // their words. Written only by teamplan.js, only from real game events.
    radio(name, text) {
      const line = document.createElement('div');
      line.className = 'feed-line radio';
      const who = document.createElement('span');
      who.textContent = name + ' (radio)';
      const what = document.createElement('span');
      what.textContent = ' — ' + text;
      line.append(who, what);
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
      setTimeout(() => { if (line.parentNode) line.remove(); }, linger(6000));
    },
    // A flashbang in the eyes: white now, clearing over the next seconds.
    // Strength 0..1 scales both the peak and the clear time.
    flashScreen(strength) {
      const el = els.flash;
      el.style.transition = 'none';
      el.style.opacity = String(Math.min(1, strength));
      void el.offsetWidth;
      el.style.transition = 'opacity ' + (0.4 + strength * 2.8).toFixed(2) + 's linear';
      el.style.opacity = '0';
    },
    banner(text, ms = 2600) {
      els.bannerText.textContent = text;
      els.banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.add('hidden'), linger(ms));
    },
    damageFlash() {
      els.vignette.classList.add('hurt');
      setTimeout(() => els.vignette.classList.remove('hurt'), 220);
    },
    setPlant(progress, label) {
      if (progress <= 0) {
        els.plantBar.classList.add('hidden');
        return;
      }
      els.plantBar.classList.remove('hidden');
      els.plantFill.style.width = Math.round(progress * 100) + '%';
      setText(els.plantLabel, 'plant', label);
    },
    setHint(text) { setText(els.hint, 'hint', text); },
    setScope(on) {
      if (cache.scope !== on) {
        cache.scope = on;
        els.scope.classList.toggle('hidden', !on);
      }
    },
    showOverlay(kind) {
      const c = COPY[kind];
      if (!c) return;
      els.title.textContent = c.title;
      els.copy.textContent = c.copy;
      els.play.textContent = c.action;
      els.overlay.hidden = false;
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(fn) { els.play.addEventListener('click', fn); },
    buildBuyMenu(list, owned, money, onBuy, utility, onBuyUtility, utilityDefs) {
      els.buyList.innerHTML = '';
      for (const item of list) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        const have = owned.includes(item.id);
        row.innerHTML = '<span class="buy-name">' + item.name + '</span>'
          + '<span class="buy-stat">DMG ' + item.damage + ' · MAG ' + item.mag + '</span>'
          + '<span class="buy-price">' + (have ? 'OWNED' : '$' + item.price) + '</span>';
        if (!have) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'buy-btn';
          btn.textContent = 'BUY';
          btn.disabled = money < item.price;
          btn.addEventListener('click', () => onBuy(item.id));
          row.appendChild(btn);
        }
        els.buyList.appendChild(row);
      }
      const HINTS = { frag: 'AoE blast · key G', flash: 'Blinds on facing · key F', smoke: 'Cuts sight lines · key T' };
      for (const type of Object.keys(utilityDefs)) {
        const def = utilityDefs[type];
        const row = document.createElement('div');
        row.className = 'buy-row';
        row.innerHTML = '<span class="buy-name">' + def.name + '</span>'
          + '<span class="buy-stat">' + HINTS[type] + ' · HELD ' + utility[type] + '</span>'
          + '<span class="buy-price">$' + def.price + '</span>';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'buy-btn';
        btn.textContent = 'BUY';
        btn.disabled = money < def.price;
        btn.addEventListener('click', () => onBuyUtility(type));
        row.appendChild(btn);
        els.buyList.appendChild(row);
      }
      setText(els.buyMoney, 'buymoney', 'FUNDS $' + money);
    },
    showBuy(show) { els.buy.classList.toggle('hidden', !show); },
    onBuyClose(fn) { els.buyClose.addEventListener('click', fn); },
  };
}
