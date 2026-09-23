import { getLangCode, getT } from '../../i18n/runtime';

// `locale` feeds Intl.DisplayNames so the tooltip names the language in the
// UI's own language; `name` is the value stored on the actor record.
const VA_LANGUAGES = [
  { code: 'JP', locale: 'ja', name: 'Japanese' },
  { code: 'ES', locale: 'es', name: 'Spanish' },
  { code: 'EN', locale: 'en', name: 'English' },
  { code: 'IT', locale: 'it', name: 'Italian' },
  { code: 'DE', locale: 'de', name: 'German' },
  { code: 'FR', locale: 'fr', name: 'French' },
  { code: 'PT', locale: 'pt', name: 'Portuguese' },
  { code: 'KR', locale: 'ko', name: 'Korean' },
  { code: 'ZH', locale: 'zh', name: 'Chinese' },
];

function languageDisplayName(locale: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([getLangCode()], { type: 'language' }).of(locale) ?? fallback;
  } catch {
    return fallback;
  }
}

function getVaLangIndex(rawLang?: string): number {
  if (!rawLang) return 0;
  const cur = rawLang.toLowerCase();
  if (cur.includes('japan') || cur.includes('japon') || cur === 'jp') return 0;
  if (cur.includes('span') || cur.includes('españ') || cur.includes('espan') || cur === 'es') return 1;
  if (cur.includes('engl') || cur.includes('ingl') || cur === 'en') return 2;
  if (cur.includes('ital') || cur === 'it') return 3;
  if (cur.includes('germ') || cur.includes('alem') || cur === 'de') return 4;
  if (cur.includes('fren') || cur.includes('franc') || cur === 'fr') return 5;
  if (cur.includes('port') || cur === 'pt') return 6;
  if (cur.includes('kore') || cur.includes('core') || cur === 'kr') return 7;
  if (cur.includes('chin') || cur.includes('mand') || cur === 'zh') return 8;
  return 0;
}

export function VoiceActorLangStepper({
  language,
  onChange,
}: {
  language?: string;
  onChange: (newLang: string) => void;
}) {
  const curIdx = getVaLangIndex(language);
  const curLang = VA_LANGUAGES[curIdx];

  const prev = () => {
    const prevIdx = (curIdx - 1 + VA_LANGUAGES.length) % VA_LANGUAGES.length;
    onChange(VA_LANGUAGES[prevIdx].name);
  };
  const next = () => {
    const nextIdx = (curIdx + 1) % VA_LANGUAGES.length;
    onChange(VA_LANGUAGES[nextIdx].name);
  };

  const tChar = getT().character;

  return (
    <div className="pr-editor-va-stepper">
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={prev}
        title={tChar.prev_lang_title}
        aria-label={tChar.prev_lang_aria}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span
        className="pr-editor-va-stepper-label"
        onClick={next}
        title={languageDisplayName(curLang.locale, curLang.name)}
      >
        {curLang.code}
      </span>
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={next}
        title={tChar.next_lang_title}
        aria-label={tChar.next_lang_aria}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
