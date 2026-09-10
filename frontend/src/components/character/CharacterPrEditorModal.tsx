import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { openUrlInBrowser } from '../../lib/github/submitCollaborativeProposal';
import { openImageCropModal } from '../shared/ImageCropModal';
import type { CharacterEntry } from '../../lib/tauri/characters';
import type { AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import type { ParsedCharacteristic } from '../../lib/character/biography-parser';
import { compareByReleaseDateThenTitle } from '../../lib/media/mapper-utils';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import { VoiceActorSearchPopup } from './VoiceActorSearchPopup';
import { FandomImportModal, type SelectedImportFields } from './FandomImportModal';
import { correlateVoiceActor } from '../../lib/character/voiceActorResolver';
import type { FandomCharacterData } from '../../lib/character/fandomImporter';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { getT } from '../../i18n/client';
import { Field } from '../shared/PrEditorField';
import { TagsInput } from '../shared/TagsInput';
import { RichTextEditor } from '../shared/RichTextEditor';
import { loadCharacterEditorData, type PendingAppearance } from '../../lib/character/characterPrEditorLoad';
import { submitCharacterProposal } from '../../lib/character/characterPrEditorSubmit';
import {
  isFieldChanged,
  characteristicsChanged as characteristicsChangedPure,
  appearancesChanged as appearancesChangedPure,
  voiceActorsChanged as voiceActorsChangedPure,
  hasChanged as hasChangedPure,
  buildChangeSummary as buildChangeSummaryPure,
  type AppearanceRow, type VoiceActorRow, type CharacterDiffFields,
} from '../../lib/character/prEditorDiff';

const RELATION_TYPE_OPTIONS = ['MAIN', 'SUPPORTING', 'BACKGROUND', 'CAMEO'];
const getRelationTypeLabels = () => {
  const t = getT();
  return {
    MAIN: t.character.role_main,
    SUPPORTING: t.character.role_supporting,
    BACKGROUND: t.character.role_background,
    CAMEO: t.character.role_cameo,
  };
};

const VA_LANGUAGES = [
  { code: 'JP', label: 'Japonés', name: 'Japanese' },
  { code: 'ES', label: 'Español', name: 'Spanish' },
  { code: 'EN', label: 'Inglés', name: 'English' },
  { code: 'IT', label: 'Italiano', name: 'Italian' },
  { code: 'DE', label: 'Alemán', name: 'German' },
  { code: 'FR', label: 'Francés', name: 'French' },
  { code: 'PT', label: 'Portugués', name: 'Portuguese' },
  { code: 'KR', label: 'Coreano', name: 'Korean' },
  { code: 'ZH', label: 'Chino', name: 'Chinese' },
];

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

function VoiceActorLangStepper({
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

  return (
    <div className="pr-editor-va-stepper">
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={prev}
        title="Idioma anterior"
        aria-label="Idioma anterior"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span
        className="pr-editor-va-stepper-label"
        onClick={next}
        title={`${curLang.label} (${curLang.name})`}
      >
        {curLang.code}
      </span>
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={next}
        title="Siguiente idioma"
        aria-label="Siguiente idioma"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

interface CachedCharacterData {
  character: CharacterEntry;
  originalCharacter: CharacterEntry;
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  originalCharacteristics: ParsedCharacteristic[];
  originalCleanBiography: string;
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
}

export function CharacterPrEditorModal() {
  const t = getT().character_editor;
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [currentId, setCurrentId] = useState('');
  const [loadNonce, setLoadNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [character, setCharacter] = useState<CharacterEntry | null>(null);
  const [originalCharacter, setOriginalCharacter] = useState<CharacterEntry | null>(null);

  const characterCacheRef = useRef<Record<string, CachedCharacterData>>({});
  // Set by openCharacterEditor's second (optional) arg, consumed once by the
  // very next loadCharacter run — the media entry a character was created
  // FROM (via PrEditorModal's "+ Crear personaje") should already be in its
  // "Apariciones en obras" list, not left for the user to search/re-add by
  // hand right after typing its name.
  const pendingAppearanceRef = useRef<{
    media_external_id: string;
    title: string;
    cover: string | null;
    release_year?: number | null;
    release_month?: number | null;
    release_day?: number | null;
  } | null>(null);

  const [name, setName] = useState('');
  const [nameNative, setNameNative] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState('');

  const [originalName, setOriginalName] = useState('');
  const [originalNameNative, setOriginalNameNative] = useState('');
  const [originalAliases, setOriginalAliases] = useState<string[]>([]);
  const [originalImageUrl, setOriginalImageUrl] = useState('');

  const [characteristics, setCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [cleanBiography, setCleanBiography] = useState('');
  const [originalCharacteristics, setOriginalCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [originalCleanBiography, setOriginalCleanBiography] = useState('');

  const [appearances, setAppearances] = useState<AppearanceRow[]>([]);
  const [originalAppearances, setOriginalAppearances] = useState<AppearanceRow[]>([]);
  const [voiceActors, setVoiceActors] = useState<VoiceActorRow[]>([]);
  const [originalVoiceActors, setOriginalVoiceActors] = useState<VoiceActorRow[]>([]);
  const [appearanceRelationType, setAppearanceRelationType] = useState('SUPPORTING');
  const [appearanceSearchOpen, setAppearanceSearchOpen] = useState(false);
  const [voiceActorSearchOpen, setVoiceActorSearchOpen] = useState(false);
  const [fandomModalOpen, setFandomModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'appearances' | 'voices'>('general');

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setCharacter(null);
    setOriginalCharacter(null);
    setErrorMsg('');
    setStatusMsg('');
    setAppearanceSearchOpen(false);
    setFandomModalOpen(false);
  };

  useEffect(() => {
    (window as any).openCharacterEditor = (
      externalId: string,
      initialAppearance?: {
        media_external_id: string;
        title: string;
        cover: string | null;
        release_year?: number | null;
        release_month?: number | null;
        release_day?: number | null;
      },
    ) => {
      pendingAppearanceRef.current = initialAppearance ?? null;
      setCurrentId(externalId);
      setIsOpen(true);
      setLoading(true);
      setLoadNonce(n => n + 1);
    };

    return () => {
      delete (window as any).openCharacterEditor;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !currentId) return;

    const loadCharacter = async () => {
      try {
        const cached = characterCacheRef.current[currentId];
        if (cached) {
          setCharacter(cached.character);
          setOriginalCharacter(cached.originalCharacter);
          setName(cached.name);
          setNameNative(cached.nameNative);
          setAliases(cached.aliases);
          setImageUrl(cached.imageUrl);
          setCharacteristics(cached.characteristics);
          setCleanBiography(cached.cleanBiography);
          setOriginalCharacteristics(cached.originalCharacteristics);
          setOriginalCleanBiography(cached.originalCleanBiography);
          setAppearances(cached.appearances);
          setOriginalAppearances(cached.originalAppearances);
          setLoading(false);
          return;
        }

        const pendingAppearance = pendingAppearanceRef.current;
        pendingAppearanceRef.current = null;
        const result = await loadCharacterEditorData(currentId, pendingAppearance, appearanceRelationType);

        setCharacter(result.character);
        setOriginalCharacter(result.originalCharacter);
        setName(result.name);
        setNameNative(result.nameNative);
        setAliases(result.aliases);
        setImageUrl(result.imageUrl);
        setCharacteristics(result.characteristics);
        setCleanBiography(result.cleanBiography);
        setOriginalCharacteristics(result.originalCharacteristics);
        setOriginalCleanBiography(result.originalCleanBiography);
        setAppearances(result.appearances);
        setOriginalAppearances(result.originalAppearances);
        setOriginalName(result.name);
        setOriginalNameNative(result.nameNative);
        setOriginalAliases(result.aliases);
        setOriginalImageUrl(result.imageUrl);
        setVoiceActors(result.voiceActors);
        setOriginalVoiceActors(result.originalVoiceActors);

        characterCacheRef.current[currentId] = {
          character: result.character,
          originalCharacter: result.originalCharacter,
          name: result.name,
          nameNative: result.nameNative,
          aliases: result.aliases,
          imageUrl: result.imageUrl,
          characteristics: result.characteristics,
          cleanBiography: result.cleanBiography,
          originalCharacteristics: result.originalCharacteristics,
          originalCleanBiography: result.originalCleanBiography,
          appearances: result.appearances,
          originalAppearances: result.originalAppearances,
        };
      } catch (err) {
        console.error('Failed to load character:', err);
        setErrorMsg('Error al cargar el personaje');
      } finally {
        setLoading(false);
      }
    };
    loadCharacter();
  }, [isOpen, currentId, loadNonce]);

  const diffFields: CharacterDiffFields = {
    name, originalName,
    nameNative, originalNameNative,
    aliases, originalAliases,
    imageUrl, originalImageUrl,
    cleanBiography, originalCleanBiography,
    characteristics, originalCharacteristics,
    appearances, originalAppearances,
    voiceActors, originalVoiceActors,
  };
  const characteristicsChanged = () => characteristicsChangedPure(characteristics, originalCharacteristics);
  const appearancesChanged = () => appearancesChangedPure(appearances, originalAppearances);
  const voiceActorsChanged = () => voiceActorsChangedPure(voiceActors, originalVoiceActors);
  const hasChanged = () => hasChangedPure(originalCharacter, diffFields);
  const buildChangeSummary = () => buildChangeSummaryPure(originalCharacter, diffFields);

  const addCharacteristic = () => setCharacteristics([...characteristics, { label: '', value: '' }]);
  const removeCharacteristic = (idx: number) => setCharacteristics(characteristics.filter((_, i) => i !== idx));
  const updateCharacteristic = (idx: number, field: 'label' | 'value', value: string) =>
    setCharacteristics(characteristics.map((c, i) => i === idx ? { ...c, [field]: value } : c));

  const removeAppearance = (mediaExternalId: string) =>
    setAppearances(appearances.filter(a => a.media_external_id !== mediaExternalId));
  const updateAppearanceRelationType = (mediaExternalId: string, relationType: string) =>
    setAppearances(appearances.map(a => a.media_external_id === mediaExternalId ? { ...a, relation_type: relationType } : a));
  const addAppearance = (result: ApiSearchResult) => {
    if (appearances.some(a => a.media_external_id === result.externalId)) return;
    const next = [...appearances, {
      media_external_id: result.externalId,
      relation_type: appearanceRelationType,
      title: result.titleMain || result.externalId,
      cover: result.coverUrl,
      release_year: result.releaseYear,
      release_month: result.releaseMonth,
      release_day: result.releaseDay,
    }];
    next.sort(compareByReleaseDateThenTitle);
    setAppearances(next);
  };

  const handleChangePhoto = async () => {
    const result = await openImageCropModal({
      title: 'Foto del personaje',
      initialUrl: imageUrl,
      aspectRatio: 3 / 4,
      saveLabel: 'Usar esta imagen',
    });
    if (result.action === 'saved') setImageUrl(result.imageUrl);
  };

  const handleSubmit = async () => {
    if (!originalCharacter || !hasChanged()) {
      setErrorMsg('No hay cambios para enviar');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const prUrl = await submitCharacterProposal({
        currentId,
        originalCharacter,
        name, nameNative, aliases, imageUrl,
        characteristics, cleanBiography, originalCleanBiography,
        appearances, originalAppearances,
        voiceActors, originalVoiceActors,
        appearancesChanged: appearancesChanged(),
        voiceActorsChanged: voiceActorsChanged(),
        changeSummary: buildChangeSummary(),
        setStatusMsg,
        statusSavingLocal: t.saving_local,
        statusPreparingProposal: t.preparing_proposal,
      });

      if (prUrl) {
        setStatusMsg(t.pr_success);
        await new Promise(r => setTimeout(r, 1500));
        delete characterCacheRef.current[currentId];
        await openUrlInBrowser(prUrl);
        handleClose();
      }
    } catch (err: any) {
      console.error('Failed to submit proposal:', err);
      setErrorMsg(err.message || t.pr_error);
    } finally {
      setSubmitting(false);
    }
  };

  const addVoiceActor = (result: AniListStaffSearchResult) => {
    const externalId = `person:a${result.id}`;
    setVoiceActorSearchOpen(false);
    if (voiceActors.some(v => v.externalId === externalId)) return;
    setVoiceActors(prev => [...prev, {
      externalId,
      name: result.name,
      native: result.nameNative || '',
      language: 'Japanese',
      image: result.image || '',
      role: 'voice',
    }]);
  };

  const updateVoiceActor = (index: number, field: keyof VoiceActorRow, value: string) => {
    setVoiceActors(prev => prev.map((va, i) => i === index ? { ...va, [field]: value } : va));
  };

  const handleVoiceActorBlur = async (index: number, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const current = voiceActors[index];
    if (current && (!current.externalId || current.externalId.startsWith('va:'))) {
      const match = await correlateVoiceActor(clean, current.language);
      if (match.matchedFrom !== 'none') {
        setVoiceActors(prev => prev.map((va, i) => {
          if (i !== index) return va;
          return {
            ...va,
            externalId: match.externalId,
            name: match.name,
            native: match.native || va.native,
            image: match.image || va.image,
          };
        }));
      }
    }
  };

  const removeVoiceActor = (index: number) => {
    setVoiceActors(prev => prev.filter((_, i) => i !== index));
  };

  const handleApplyFandomData = (data: FandomCharacterData, fields: SelectedImportFields) => {
    if (fields.name && data.name) {
      setName(data.name);
    }
    if (fields.image && data.imageUrl) {
      setImageUrl(data.imageUrl);
    }
    if (fields.aliases && data.aliases.length > 0) {
      setAliases(prev => Array.from(new Set([...prev, ...data.aliases])));
    }
    if (fields.characteristics && data.characteristics.length > 0) {
      setCharacteristics(prev => {
        if (prev.length === 0) return data.characteristics;
        const existingLabels = new Set(prev.map(c => c.label.toLowerCase().trim()));
        const toAdd = data.characteristics.filter(c => !existingLabels.has(c.label.toLowerCase().trim()));
        return [...prev, ...toAdd];
      });
    }
    if (fields.biography && data.cleanBiography) {
      setCleanBiography(data.cleanBiography);
    }
    if (fields.voiceActors && data.voiceActors.length > 0) {
      const newVas: VoiceActorRow[] = data.voiceActors.map(va => ({
        externalId: va.externalId || `va:${va.name}`,
        name: va.name,
        native: va.native || '',
        language: va.language,
        image: va.image || '',
        role: 'voice',
      }));
      setVoiceActors(prev => {
        const existingNames = new Set(prev.map(v => v.name.toLowerCase().trim()));
        const toAdd = newVas.filter(v => !existingNames.has(v.name.toLowerCase().trim()));
        return [...prev, ...toAdd];
      });
    }

    setStatusMsg(t.import_fandom_success);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  if (!mounted || !isOpen) return null;

  if (loading) {
    return createPortal(
      <div className="pr-editor-overlay pr-editor-overlay--nested" onClick={handleClose}>
        <div className="pr-editor-modal pr-editor-modal--loading" onClick={e => e.stopPropagation()}>
          <div className="spinner" />
        </div>
      </div>,
      document.body
    );
  }

  if (!character) return null;

  return createPortal(
    <div className="pr-editor-overlay pr-editor-overlay--nested" onClick={handleClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span className="pr-editor-title">{t.title}</span>
            <span className="pr-editor-subtitle">ID: {currentId}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {statusMsg && (
              <div className="pr-editor-header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--accent, #7c6af7)' }}>
                <div className="spinner spinner--small" style={{ width: '14px', height: '14px', border: '2px solid rgba(124, 106, 247, 0.2)', borderTopColor: 'var(--accent, #7c6af7)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>{statusMsg}</span>
              </div>
            )}
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--secondary"
              onClick={() => setFandomModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              title={t.import_fandom_title}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{t.import_fandom}</span>
            </button>
          </div>
        </div>

        <div className="pr-editor-tabs">
          <button type="button" className={`pr-editor-tab-btn${activeTab === 'general' ? ' active' : ''}`} onClick={() => setActiveTab('general')}>
            General
            {characteristicsChanged() && <span className="pr-editor-tab-changed-dot" />}
          </button>
          <button type="button" className={`pr-editor-tab-btn${activeTab === 'appearances' ? ' active' : ''}`} onClick={() => setActiveTab('appearances')}>
            {t.appearances}
            {appearancesChanged() && <span className="pr-editor-tab-changed-dot" />}
          </button>
          <button type="button" className={`pr-editor-tab-btn${activeTab === 'voices' ? ' active' : ''}`} onClick={() => setActiveTab('voices')}>
            {t.voice_actors}
            {voiceActorsChanged() && <span className="pr-editor-tab-changed-dot" />}
          </button>
        </div>

        <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {activeTab === 'general' && (
          <>
          {/* Cabecera: Foto + Datos Básicos */}
          <div className="pr-editor-section" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1.5rem', alignItems: 'start', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                className="pr-editor-char-photo-wrap"
                onClick={handleChangePhoto}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleChangePhoto(); } }}
                title={t.change_image}
              >
                {imageUrl
                  ? <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} />
                  : <span className="pr-editor-cover-placeholder">{t.no_image}</span>}
                <div className="pr-editor-photo-hover-overlay">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>{t.change_image}</span>
                </div>
              </div>
            </div>

            <div className="pr-editor-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label={t.name} changed={isFieldChanged(name, originalCharacter?.name)}>
                <input type="text" value={name} onChange={e => setName(e.target.value)} />
              </Field>

              <Field label={t.native_name} changed={isFieldChanged(nameNative, originalCharacter?.name_native)}>
                <input type="text" value={nameNative} onChange={e => setNameNative(e.target.value)} placeholder={t.optional} />
              </Field>

              <Field label={t.aliases} changed={aliases.join(',') !== (originalCharacter?.aliases_csv || '')} full>
                <TagsInput tags={aliases} onChange={setAliases} placeholder={t.aliases_ph} />
              </Field>
            </div>
          </div>

          {/* Características */}
          <div className="pr-editor-section" style={{ marginBottom: '2rem' }}>
            <span className="pr-editor-section-title">
              {t.characteristics}
              {characteristicsChanged() && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div className="pr-editor-char-grid">
              {characteristics.map((c, idx) => {
                const isLong = c.value.replace(/<[^>]+>/g, '').length > 200;
                return (
                <div key={idx} className={`pr-editor-char-row${isLong ? ' pr-editor-char-row--wide' : ''}`}>
                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={c.label}
                    onChange={e => updateCharacteristic(idx, 'label', e.target.value)}
                    placeholder={t.char_label_ph}
                  />
                  <div className="pr-editor-char-divider" />
                  <RichTextEditor
                    className="pr-editor-char-richtext"
                    value={c.value}
                    onChange={v => updateCharacteristic(idx, 'value', v)}
                    placeholder={t.char_value_ph}
                  />
                  <button
                    type="button"
                    className="pr-editor-char-remove"
                    onClick={() => removeCharacteristic(idx)}
                    title={t.remove_characteristic}
                  >
                    ×
                  </button>
                </div>
                );
              })}
            </div>
            <button
              type="button"
              className="pr-editor-add-btn"
              onClick={addCharacteristic}
              style={{ marginTop: '0.75rem' }}
            >
              {t.add_characteristic}
            </button>
          </div>

          {/* ── Biografía ── */}
          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
              <Field label={t.biography} changed={isFieldChanged(cleanBiography, originalCleanBiography)} full>
                <RichTextEditor
                  value={cleanBiography}
                  onChange={setCleanBiography}
                  placeholder={t.biography_ph}
                />
              </Field>
            </div>
          </div>
          </>
          )}

          {activeTab === 'appearances' && (
          <>
          {/* ── Apariciones ── */}
          <div className="pr-editor-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span className="pr-editor-section-title" style={{ margin: 0 }}>
                {t.appearances} ({appearances.length})
                {appearancesChanged() && <span className="pr-editor-section-changed-dot" />}
              </span>
              <button type="button" className="pr-editor-add-btn" onClick={() => setAppearanceSearchOpen(true)}>
                {t.add_appearance}
              </button>
            </div>

            <div className="pr-editor-media-group-cards pr-editor-media-group-cards--wide">
              {appearances.map(a => (
                <div key={a.media_external_id} className="pr-editor-media-card">
                  <div className="pr-editor-media-card-cover">
                    {a.cover
                      ? <img src={a.cover} alt="" />
                      : <div className="pr-editor-media-card-placeholder" />}
                    <button
                      type="button"
                      className="pr-editor-media-card-remove"
                      onClick={() => removeAppearance(a.media_external_id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pr-editor-media-card-title" title={a.release_year ? `${a.title} (${a.release_year})` : a.title}>
                    {a.title}
                    {a.release_year ? <span style={{ opacity: 0.65, fontSize: '0.62rem', marginLeft: '0.25rem' }}>({a.release_year})</span> : null}
                  </div>
                  <select
                    value={a.relation_type ?? 'SUPPORTING'}
                    onChange={e => updateAppearanceRelationType(a.media_external_id, e.target.value)}
                    className="pr-editor-media-card-select"
                    style={{ fontSize: '0.7rem' }}
                  >
                    {RELATION_TYPE_OPTIONS.map(type => (
                      <option key={type} value={type}>{getRelationTypeLabels()[type as keyof ReturnType<typeof getRelationTypeLabels>] || type}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
          </>
          )}

          {activeTab === 'voices' && (
          <>
          {/* Actores de Voz */}
          <div className="pr-editor-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span className="pr-editor-section-title" style={{ margin: 0 }}>
                {t.voice_actors} ({voiceActors.length})
                {voiceActorsChanged() && <span className="pr-editor-section-changed-dot" />}
              </span>
              <button type="button" className="pr-editor-add-btn" onClick={() => setVoiceActorSearchOpen(true)}>
                {t.add_voice_actor}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
              {voiceActors.map((va, idx) => (
                <div key={idx} className="pr-editor-va-card">
                  <button
                    type="button"
                    className="pr-editor-media-card-remove"
                    onClick={() => removeVoiceActor(idx)}
                    title={t.remove_voice_actor}
                  >
                    ×
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '1rem' }}>
                    {va.image ? (
                      <img src={va.image} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0 }}>
                        {va.name ? va.name.charAt(0).toUpperCase() : '?'}
                      </div>
                    )}
                    <input
                      type="text"
                      className="pr-editor-char-input"
                      value={va.name}
                      onChange={e => updateVoiceActor(idx, 'name', e.target.value)}
                      onBlur={() => handleVoiceActorBlur(idx, va.name)}
                      placeholder={t.actor_name_ph}
                      style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.75rem' }}
                    />
                  </div>

                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={va.native}
                    onChange={e => updateVoiceActor(idx, 'native', e.target.value)}
                    placeholder={t.actor_native_ph}
                    style={{ fontSize: '0.7rem' }}
                  />

                  <VoiceActorLangStepper
                    language={va.language}
                    onChange={lang => updateVoiceActor(idx, 'language', lang)}
                  />
                </div>
              ))}
            </div>
          </div>
          </>
          )}
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={handleClose} disabled={submitting}>
            {t.cancel}
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting || !hasChanged()}>
            {submitting ? t.submitting : t.submit}
          </button>
        </div>
      </div>

      {appearanceSearchOpen && (
        <MediaSearchPopup
          onSelect={addAppearance}
          onClose={() => setAppearanceSearchOpen(false)}
          excludeIds={appearances.map(a => a.media_external_id)}
          closeOnSelect={false}
        />
      )}

      {voiceActorSearchOpen && (
        <VoiceActorSearchPopup
          onSelect={addVoiceActor}
          onClose={() => setVoiceActorSearchOpen(false)}
          excludeIds={voiceActors.map(v => v.externalId).filter((id): id is string => !!id)}
        />
      )}

      {fandomModalOpen && (
        <FandomImportModal
          isOpen={fandomModalOpen}
          onClose={() => setFandomModalOpen(false)}
          onApply={handleApplyFandomData}
        />
      )}
    </div>,
    document.body
  );
}
