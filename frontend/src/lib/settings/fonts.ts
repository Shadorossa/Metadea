import { saveUserInfo, getUserInfo } from '../tauri';
import { runSave } from './autosave';

const PROFILE_FONTS = [
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

export function getFontFile(fontId: string): string | undefined {
  return PROFILE_FONTS.find(f => f.id === fontId)?.file;
}

export async function initFontPicker(_username: string, showToast: (msg?: string) => void) {
  // The font preview and the display-name field are the same element now
  // (#display-name-input) — this only ever touches its font-family style,
  // never its value/text, which display-name.ts owns exclusively (loads
  // the saved name, saves edits). Doing both from here used to fight over
  // the same textContent on a plain <div>; now that it's a real <input>,
  // there isn't even a textContent to fight over.
  const preview = document.getElementById('display-name-input') as HTMLInputElement;
  const label   = document.getElementById('font-name-label')!;
  const btnPrev = document.getElementById('font-prev')!;
  const btnNext = document.getElementById('font-next')!;
  if (!preview) return;

  const info    = await getUserInfo();
  const savedId = (info.font as string | undefined) ?? 'inter';
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
    preview.style.fontFamily = `"pf-${f.id}", sans-serif`;
    label.textContent = f.name;
  }

  btnPrev.addEventListener('click', async () => {
    idx = (idx - 1 + PROFILE_FONTS.length) % PROFILE_FONTS.length;
    render();
    await runSave(() => saveUserInfo({ font: PROFILE_FONTS[idx].id }), showToast, 'Failed to save font:');
  });

  btnNext.addEventListener('click', async () => {
    idx = (idx + 1) % PROFILE_FONTS.length;
    render();
    await runSave(() => saveUserInfo({ font: PROFILE_FONTS[idx].id }), showToast, 'Failed to save font:');
  });

  render();
}
