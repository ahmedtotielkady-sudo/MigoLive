/* MigoLive Android system-back navigation.
 * Uses Capacitor App's backButton event so Android back stays inside the app.
 */
(function () {
  'use strict';

  function getAppPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.App) return cap.Plugins.App;
    if (typeof cap.registerPlugin === 'function') {
      try { return cap.registerPlugin('App'); } catch (_) {}
    }
    return null;
  }

  async function installBackHandler() {
    const app = getAppPlugin();
    if (!app || typeof app.addListener !== 'function') {
      console.warn('MigoLive: Capacitor App plugin is unavailable; Android back handler was not installed.');
      return;
    }

    await app.addListener('backButton', function (event) {
      // Close the topmost ordinary dialog before navigating away from its page.
      const dialogs = document.querySelectorAll('.dlg');
      if (dialogs.length) {
        dialogs[dialogs.length - 1].remove();
        return;
      }

      const hash = window.location.hash || '';
      const atHome = hash === '#rooms' ||
        (document.body.classList.contains('auth-screen') && (!hash || hash === '#rooms'));

      // Nested pages, games, room screens and previous tabs are handled by
      // the app's existing popstate/hashchange navigation.
      if (event && event.canGoBack) {
        window.history.back();
        return;
      }

      // If history is unexpectedly empty on a nested screen, return to Home
      // instead of allowing Android to close the activity.
      if (!atHome) {
        window.location.hash = '#rooms';
        return;
      }

      // At the root only, ask before leaving the application.
      if (window.__migoExitPromptOpen) return;
      window.__migoExitPromptOpen = true;
      const shouldExit = window.confirm('هل تريد الخروج من تطبيق ميجو لايف؟');
      window.__migoExitPromptOpen = false;
      if (shouldExit && typeof app.exitApp === 'function') {
        app.exitApp();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installBackHandler, { once: true });
  } else {
    installBackHandler();
  }
})();
