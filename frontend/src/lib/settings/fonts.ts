import { saveUserInfo, getUserInfo } from '../tauri';

export const PROFILE_FONTS = [
  { id: 'inter',            name: 'Inter',             file: 'inter/Inter-VariableFont_opsz,wght.woff2' },
  { id: 'roboto',           name: 'Roboto',            file: 'roboto/Roboto-VariableFont_wdth,wght.woff2' },
  { id: 'montserrat',       name: 'Montserrat',        file: 'montserrat/Montserrat-VariableFont_wght.woff2' },
  { id: 'raleway',          name: 'Raleway',           file: 'raleway/Raleway-VariableFont_wght.woff2' },
  { id: 'syne',             name: 'Syne',              file: 'syne/Syne-VariableFont_wght.woff2' },
  { id: 'sourcesanspro',    name: 'Source Sans',       file: 'sourcesanspro/SourceSans3-VariableFont_wght.woff2' },
  { id: 'lora',             name: 'Lora',              file: 'lora/Lora-VariableFont_wght.woff2' },
  { id: 'playfairdisplay',  name: 'Playfair Display',  file: 'playfairdisplay/PlayfairDisplay-VariableFont_wght.woff2' },
  { id: 'alegreya',         name: 'Alegreya',          file: 'alegreya/Alegreya-VariableFont_wght.woff2' },
  { id: 'fraunces',         name: 'Fraunces',          file: 'fraunces/Fraunces-VariableFont_SOFT,WONK,opsz,wght.woff2' },
  { id: 'librebaskerville', name: 'Libre Baskerville', file: 'librebaskerville/LibreBaskerville-Bold.woff2' },
  { id: 'inconsolata',      name: 'Inconsolata',       file: 'inconsolata/Inconsolata-VariableFont_wdth,wght.woff2' },
] as const;

export async function initFontPicker(username: string, showToast: (msg?: string) => void) {
  const preview = document.getElementById('font-preview-name')!;
  const label   = document.getElementById('font-name-label')!;
  const btnPrev = document.getElementById('font-prev')!;
  const btnNext = document.getElementById('font-next')!;

  const info    = await getUserInfo();
  const savedId = (info.profile_font as string | undefined) ?? 'inter';
  let idx       = PROFILE_FONTS.findIndex(f => f.id === savedId);
  if (idx < 0) idx = 0;

  // Pre-load all fonts so switching is instant
  const style = document.createElement('style');
  style.textContent = PROFILE_FONTS.map(f =>
    `@font-face { font-family: "pf-${f.id}"; src: url("/fonts/${f.file}") format("woff2"); font-display: swap; }`
  ).join('\n');
  document.head.appendChild(style);

  function render() {
    const f = PROFILE_FONTS[idx];
    preview.textContent = username;
    preview.style.fontFamily = `"pf-${f.id}", sans-serif`;
    label.textContent = f.name;
  }

  btnPrev.addEventListener('click', async () => {
    idx = (idx - 1 + PROFILE_FONTS.length) % PROFILE_FONTS.length;
    render();
    await saveUserInfo({ profile_font: PROFILE_FONTS[idx].id });
    showToast('Fuente guardada');
  });

  btnNext.addEventListener('click', async () => {
    idx = (idx + 1) % PROFILE_FONTS.length;
    render();
    await saveUserInfo({ profile_font: PROFILE_FONTS[idx].id });
    showToast('Fuente guardada');
  });

  render();
}
