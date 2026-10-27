// Profile banner/avatar/font from the last visit, before first paint. Loaded as a file, not inline: Tauri's CSP allows an inline script only on the page whose hash it carries, and ClientRouter keeps the first page's CSP (see astro.config.mjs).
        (function() {
          const fontFiles = {
  inter: 'inter/Inter-VariableFont_opsz,wght.woff2',
  roboto: 'roboto/Roboto-VariableFont_wdth,wght.woff2',
  montserrat: 'montserrat/Montserrat-VariableFont_wght.woff2',
  raleway: 'raleway/Raleway-VariableFont_wght.woff2',
  syne: 'syne/Syne-VariableFont_wght.woff2',
  sourcesanspro: 'sourcesanspro/SourceSans3-VariableFont_wght.woff2',
  lora: 'lora/Lora-VariableFont_wght.woff2',
  playfairdisplay: 'playfairdisplay/PlayfairDisplay-VariableFont_wght.woff2',
  alegreya: 'alegreya/Alegreya-VariableFont_wght.woff2',
  fraunces: 'fraunces/Fraunces-VariableFont_SOFT,WONK,opsz,wght.woff2',
  librebaskerville: 'librebaskerville/LibreBaskerville-Bold.woff2',
  inconsolata: 'inconsolata/Inconsolata-VariableFont_wdth,wght.woff2'
};
          const bannerCache = localStorage.getItem('profile_banner_cache');
          const avatarCache = localStorage.getItem('profile_avatar_cache');
          const fontCache = localStorage.getItem('profile_font_cache') || 'inter';
          const nameCache = localStorage.getItem('auth_username') || localStorage.getItem('profile_username_cache') || '';
          
          const fontFile = fontFiles[fontCache];
          if (fontFile) {
            const s = document.createElement('style');
            // A unique family name per font (not a shared "profile-font"
            // constant) so switching fonts in Settings is guaranteed to
            // actually change the h1's rendered font-family value and
            // force a repaint — reusing the same family name across
            // navigations relied on the browser silently rebinding an
            // already-painted @font-face, which isn't reliable.
            s.textContent = '@font-face { font-family: "pf-' + fontCache + '"; src: url("/fonts/' + fontFile + '") format("woff2"); font-display: block; }';
            document.head.appendChild(s);
          }

          if (bannerCache) {
            const sBanner = document.createElement('style');
            sBanner.id = 'early-banner-style';
            sBanner.textContent = '.profile-banner { background-image: url("' + bannerCache.replace(/"/g, '\\"') + '") !important; background-size: cover !important; background-position: center !important; } .profile-banner::after { display: none !important; }';
            document.head.appendChild(sBanner);
          }
          if (nameCache) {
            const avatarHtml = avatarCache
    ? '<img class="profile-avatar" src="' + avatarCache + '" alt="' + nameCache + '" referrerpolicy="no-referrer">'
    : '<div class="profile-avatar-placeholder">' + (nameCache[0] || '?').toUpperCase() + '</div>';
            const container = document.getElementById('banner-content');
            if (container) {
              container.innerHTML = avatarHtml + '<h1 class="profile-username-large" style="font-family: \'pf-' + fontCache + '\', sans-serif;">' + nameCache + '</h1>';
            }
          }
        })();
