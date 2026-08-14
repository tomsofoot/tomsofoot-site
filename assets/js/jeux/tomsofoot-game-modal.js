(function (window, document) {
  'use strict';

  const VALID_STATES = new Set(['available', 'completed', 'unavailable']);

  const stateLabel = {
    available: 'À JOUER',
    completed: 'TERMINÉ',
    unavailable: 'INDISPONIBLE'
  };

  let root;
  let dialog;
  let cards = [];
  let games = [];
  let selectedIndex = 0;
  let previousFocus = null;
  let options = {};

  function sanitizeGame(game) {
    return {
      id: String(game.id || ''),
      state: VALID_STATES.has(game.state) ? game.state : 'available',
      href: typeof game.href === 'string' ? game.href : '',
      label: typeof game.label === 'string' ? game.label : ''
    };
  }

  function getGame(id) {
    return games.find((game) => game.id === id);
  }

  function getSelectableIndexes() {
    return cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => getGame(card.dataset.gameCard)?.state !== 'unavailable')
      .map(({ index }) => index);
  }

  function selectCard(index, focusButton) {
    if (!cards.length) return;
    const selectable = getSelectableIndexes();
    if (!selectable.length) return;

    selectedIndex = selectable.includes(index) ? index : selectable[0];
    cards.forEach((card, cardIndex) => {
      card.classList.toggle('is-selected', cardIndex === selectedIndex);
      card.setAttribute('aria-current', cardIndex === selectedIndex ? 'true' : 'false');
    });

    if (focusButton) {
      cards[selectedIndex].querySelector('[data-game-select]')?.focus({ preventScroll: true });
    }
  }

  function render() {
    let completed = 0;

    cards.forEach((card) => {
      const game = getGame(card.dataset.gameCard);
      if (!game) return;

      card.dataset.state = game.state;
      card.querySelector('[data-game-status]').textContent = game.label || stateLabel[game.state];

      const button = card.querySelector('[data-game-select]');
      const unavailable = game.state === 'unavailable';
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', String(unavailable));

      if (game.state === 'completed') {
        completed += 1;
        button.querySelector('span').textContent = 'REJOUER HORS CLASSEMENT';
      } else if (game.id === 'daily-player') {
        button.querySelector('span').textContent = 'JOUER MAINTENANT';
      } else {
        button.querySelector('span').textContent = 'COMMENCER LE PARCOURS';
      }
    });

    root.querySelector('[data-completed-count]').textContent = `${completed}/${games.length}`;
    const message = root.querySelector('[data-game-choice-message]');
    const remaining = games.filter((game) => game.state === 'available').length;
    message.textContent = remaining === 0
      ? 'VOS DÉFIS DU JOUR SONT TERMINÉS'
      : remaining === 1
        ? 'UN DÉFI VOUS ATTEND ENCORE AUJOURD’HUI'
        : 'DEUX DÉFIS VOUS ATTENDENT AUJOURD’HUI';

    const recommendedIndex = cards.findIndex((card) => getGame(card.dataset.gameCard)?.state === 'available');
    selectCard(recommendedIndex >= 0 ? recommendedIndex : 0, false);
  }

  function open() {
    if (!root || root.classList.contains('is-open')) return;
    previousFocus = document.activeElement;
    root.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    dialog.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('tomsofoot:game-choice:open'));
  }

  function close() {
    if (!root || !root.classList.contains('is-open')) return;
    root.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    previousFocus?.focus?.({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('tomsofoot:game-choice:close'));
  }

  function activateSelected() {
    cards[selectedIndex]?.querySelector('[data-game-select]:not(:disabled)')?.click();
  }

  function moveSelection(direction) {
    const selectable = getSelectableIndexes();
    if (!selectable.length) return;
    const currentPosition = Math.max(0, selectable.indexOf(selectedIndex));
    const nextPosition = (currentPosition + direction + selectable.length) % selectable.length;
    selectCard(selectable[nextPosition], true);
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    if (!root.classList.contains('is-open')) return;

    if (event.key === 'Escape' || event.key.toLowerCase() === 'b') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === 'Enter' || event.key.toLowerCase() === 'a') {
      if (document.activeElement === dialog || document.activeElement?.matches('[data-game-select]')) {
        event.preventDefault();
        activateSelected();
      }
      return;
    }
    trapFocus(event);
  }

  function handleGameSelection(event) {
    const button = event.target.closest('[data-game-select]');
    if (!button) return;
    const game = getGame(button.dataset.gameSelect);
    if (!game || game.state === 'unavailable') return;

    const detail = { game: { ...game }, originalEvent: event };
    const selectionEvent = new CustomEvent('tomsofoot:game-choice:select', {
      detail,
      bubbles: true,
      cancelable: true
    });
    const allowed = root.dispatchEvent(selectionEvent);

    if (typeof options.onSelect === 'function') {
      options.onSelect(detail.game, event);
      return;
    }
    if (allowed && game.href) window.location.assign(game.href);
  }

  function init(userOptions) {
    options = userOptions || {};
    root = document.querySelector('[data-game-choice-root]');
    if (!root) throw new Error('TomsoFootGameChoice : racine du pop-up introuvable.');

    dialog = root.querySelector('[role="dialog"]');
    cards = [...root.querySelectorAll('[data-game-card]')];
    games = (options.games || []).map(sanitizeGame);

    if (!games.length) {
      games = cards.map((card) => sanitizeGame({
        id: card.dataset.gameCard,
        state: card.dataset.state
      }));
    }

    root.querySelectorAll('[data-game-choice-close]').forEach((element) => {
      element.addEventListener('click', close);
    });
    document.querySelectorAll('[data-open-game-choice]').forEach((element) => {
      element.addEventListener('click', open);
    });
    cards.forEach((card, index) => {
      card.addEventListener('pointerdown', () => selectCard(index, false));
      card.addEventListener('focusin', () => selectCard(index, false));
    });
    root.addEventListener('click', handleGameSelection);
    document.addEventListener('keydown', onKeydown);

    render();
    if (options.openOnLoad || root.classList.contains('is-open')) {
      root.classList.remove('is-open');
      requestAnimationFrame(open);
    }

    return api;
  }

  function setGames(nextGames) {
    games = nextGames.map(sanitizeGame);
    render();
  }

  const api = { init, open, close, setGames };
  window.TomsoFootGameChoice = api;
})(window, document);
