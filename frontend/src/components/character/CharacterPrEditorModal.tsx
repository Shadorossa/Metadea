import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getCharacter, saveCharacter, getCharacterAppearances, saveCharacterAppearances,
  type CharacterEntry, type CharacterAppearance,
} from '../../lib/tauri/characters';
import { getCharacterActors, saveCharacterActors, type DbCharacterActor } from '../../lib/tauri/actors';
import { getCatalogEntry, saveCatalogEntry } from '../../lib/tauri/catalog';
import { fetchAniListCharacterDetail, fetchAniListDetail, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { submitCollaborativeProposal, openUrlInBrowser, type CharacterProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { openImageCropModal } from '../shared/ImageCropModal';
import { parseCharacterBiography, buildBiographyHtml, type ParsedCharacteristic } from '../../lib/character/biography-parser';
import { compareByReleaseDateDesc } from '../../lib/media/mapper-utils';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import { VoiceActorSearchPopup } from './VoiceActorSearchPopup';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { getT } from '../../i18n/client';
import { normField, ChangedDot, Field } from '../shared/PrEditorField';
import { TagsInput } from '../shared/TagsInput';
import {
  isFieldChanged,
  characteristicsChanged as characteristicsChangedPure,
  appearancesChanged as appearancesChangedPure,
  voiceActorsChanged as voiceActorsChangedPure,
  hasChanged as hasChangedPure,
  buildChangeSummary as buildChangeSummaryPure,
  type AppearanceRow, type VoiceActorRow, type CharacterDiffFields,
} from '../../lib/character/prEditorDiff';

const RELATION_TYPE_OPTIONS = ['MAIN', 'SUPPORTING', 'BACKGROUND'];
const getRelationTypeLabels = () => {
  const t = getT();
  return {
    MAIN: t.character.role_main,
    SUPPORTING: t.character.role_supporting,
    BACKGROUND: t.character.role_background,
  };
};

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

  const bioTextareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustBioHeight = () => {
    if (bioTextareaRef.current) {
      bioTextareaRef.current.style.height = 'auto';
      bioTextareaRef.current.style.height = `${Math.max(120, bioTextareaRef.current.scrollHeight)}px`;
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(adjustBioHeight, 50);
    }
  }, [cleanBiography, isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    setCharacter(null);
    setOriginalCharacter(null);
    setErrorMsg('');
    setStatusMsg('');
    setAppearanceSearchOpen(false);
  };

  useEffect(() => {
    (window as any).openCharacterEditor = (externalId: string) => {
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

        const now = new Date().toISOString();
        const cleanCharIdStr = currentId.includes(':') ? currentId.split(':')[1] : currentId;
        const anilistCharId = parseInt(cleanCharIdStr.replace(/\D/g, ''), 10);

        let anilistDetail = null;
        if (!isNaN(anilistCharId) && anilistCharId > 0) {
          try {
            anilistDetail = await fetchAniListCharacterDetail(anilistCharId);
          } catch (err) {
            console.error('Failed to fetch from AniList:', err);
          }
        }

        const localData: CharacterEntry = (await getCharacter(currentId)) ?? {
          id: '',
          external_id: currentId,
          name: '',
          created_at: now,
          updated_at: now,
        };

        const data = anilistDetail ? {
          ...localData,
          name: anilistDetail.name.full || localData.name,
          name_native: anilistDetail.name.native || localData.name_native,
          biography: anilistDetail.description || localData.biography,
          image_url: anilistDetail.image?.large || localData.image_url,
        } : localData;

        setCharacter(data);
        setOriginalCharacter(data);
        setName(data.name || '');
        setNameNative(data.name_native || '');

        const aniListAlt = [
          ...(anilistDetail?.name?.alternative ?? []),
          ...(anilistDetail?.name?.alternativeSpoiler ?? []),
        ];
        const localAlt = (data.aliases_csv || '').split(',').map(a => a.trim()).filter(Boolean);
        const combinedAliases = Array.from(new Set([...localAlt, ...aniListAlt]));
        setAliases(combinedAliases);
        setImageUrl(data.image_url || '');

        const { characteristics: parsedStats, cleanBiography: parsedBio } = parseCharacterBiography(data.biography);
        const addedLabels = new Set(parsedStats.map(c => c.label.toLowerCase()));
        const allCharacteristics = [...parsedStats];

        if (anilistDetail?.gender && !addedLabels.has('gender') && !addedLabels.has('género')) {
          allCharacteristics.push({ label: 'Gender', value: anilistDetail.gender });
        }
        if (anilistDetail?.age && !addedLabels.has('age') && !addedLabels.has('edad')) {
          allCharacteristics.push({ label: 'Age', value: String(anilistDetail.age) });
        }
        if (anilistDetail?.bloodType && !addedLabels.has('blood type') && !addedLabels.has('bloodtype') && !addedLabels.has('grupo sanguíneo')) {
          allCharacteristics.push({ label: 'Blood Type', value: anilistDetail.bloodType });
        }
        if (anilistDetail?.dateOfBirth && (anilistDetail.dateOfBirth.day || anilistDetail.dateOfBirth.month)) {
          if (!addedLabels.has('birthday') && !addedLabels.has('cumpleaños')) {
            const day = anilistDetail.dateOfBirth.day ?? '?';
            const month = anilistDetail.dateOfBirth.month ?? '?';
            const year = anilistDetail.dateOfBirth.year ? `/${anilistDetail.dateOfBirth.year}` : '';
            allCharacteristics.push({ label: 'Birthday', value: `${day}/${month}${year}` });
          }
        }

        setCharacteristics(allCharacteristics);
        setCleanBiography(parsedBio);
        setOriginalCharacteristics(allCharacteristics);
        setOriginalCleanBiography(parsedBio);

        // ── APARICIONES: Usar datos guardados localmente o fallback a AniList ──
        const rawAppearances = await getCharacterAppearances(currentId).catch(() => [] as CharacterAppearance[]);
        let resolved: AppearanceRow[] = [];

        const anilistMediaCache: Record<string, { title: string; cover: string | null; year: number | null; month: number | null; day: number | null }> = {};
        if (anilistDetail?.media?.edges) {
          for (const edge of anilistDetail.media.edges) {
            const extId = `${edge.node.type.toLowerCase()}:${edge.node.id}`;
            anilistMediaCache[extId] = {
              title: edge.node.title.userPreferred || `${edge.node.type}:${edge.node.id}`,
              cover: edge.node.coverImage?.large || null,
              year: edge.node.startDate?.year ?? null,
              month: edge.node.startDate?.month ?? null,
              day: edge.node.startDate?.day ?? null,
            };
          }
        }

        if (rawAppearances.length > 0) {
          resolved = await Promise.all(rawAppearances.map(async (a): Promise<AppearanceRow> => {
            let entry = await getCatalogEntry(a.media_external_id).catch(() => null);
            const cached = anilistMediaCache[a.media_external_id];
            if (!entry && cached) {
              entry = {
                id: '',
                external_id: a.media_external_id,
                type: a.media_external_id.split(':')[0].toUpperCase(),
                title_main: cached.title,
                cover_url: cached.cover,
                release_year: cached.year,
                release_month: cached.month,
                release_day: cached.day,
                created_at: now,
                updated_at: now,
              };
              await saveCatalogEntry(entry).catch(() => {});
            }
            return {
              media_external_id: a.media_external_id,
              relation_type: a.relation_type ?? null,
              title: entry?.title_main || cached?.title || a.media_external_id,
              cover: entry?.cover_url ?? cached?.cover ?? null,
              release_year: entry?.release_year ?? cached?.year ?? null,
              release_month: entry?.release_month ?? cached?.month ?? null,
              release_day: entry?.release_day ?? cached?.day ?? null,
            };
          }));
        } else if (anilistDetail?.media?.edges) {
          resolved = anilistDetail.media.edges.map((edge: any): AppearanceRow => {
            const extId = `${edge.node.type.toLowerCase()}:${edge.node.id}`;
            return {
              media_external_id: extId,
              relation_type: edge.characterRole ?? 'SUPPORTING',
              title: edge.node.title.userPreferred || extId,
              cover: edge.node.coverImage?.large || null,
              release_year: edge.node.startDate?.year ?? null,
              release_month: edge.node.startDate?.month ?? null,
              release_day: edge.node.startDate?.day ?? null,
            };
          });
        }

        resolved.sort(compareByReleaseDateDesc);
        setAppearances(resolved);
        setOriginalAppearances(resolved);

        setOriginalName(data.name || '');
        setOriginalNameNative(data.name_native || '');
        setOriginalAliases(combinedAliases);
        setOriginalImageUrl(data.image_url || '');

        // Live AniList cast list goes in first (full name/image) — a
        // community-shared actor's proposal only ever carries role/language
        // (see handleSubmit: AniList's own data isn't re-proposed), so
        // persisted rows can have a blank name/native/image. Overlaying
        // persisted second, only over non-empty fields, means role/language
        // (the actual curated data) always win while name/image still fall
        // back to AniList's live copy instead of showing blank.
        const vaMap = new Map<string, VoiceActorRow>();
        if (anilistDetail?.media?.edges) {
          for (const edge of anilistDetail.media.edges) {
            if (edge.voiceActors) {
              for (const va of edge.voiceActors) {
                const key = va.id ? `person:a${va.id}` : `va:${va.name?.full || ''}`;
                if (!vaMap.has(key)) {
                  vaMap.set(key, {
                    externalId: key,
                    name: va.name?.userPreferred || va.name?.full || '',
                    native: va.name?.native || '',
                    language: va.languageV2 || 'Japanese',
                    image: va.image?.large || va.image?.medium || '',
                    role: 'voice',
                  });
                }
              }
            }
          }
        }
        const persistedActors = await getCharacterActors(currentId).catch(() => [] as DbCharacterActor[]);
        for (const a of persistedActors) {
          const live = vaMap.get(a.external_id);
          vaMap.set(a.external_id, {
            externalId: a.external_id,
            name: a.name || live?.name || '',
            native: a.name_native || live?.native || '',
            language: a.language || live?.language || 'Japanese',
            image: a.image_url || live?.image || '',
            role: a.role || live?.role || 'voice',
          });
        }
        const initialVas = Array.from(vaMap.values());
        setVoiceActors(initialVas);
        setOriginalVoiceActors(initialVas);

        characterCacheRef.current[currentId] = {
          character: data,
          originalCharacter: data,
          name: data.name || '',
          nameNative: data.name_native || '',
          aliases: combinedAliases,
          imageUrl: data.image_url || '',
          characteristics: allCharacteristics,
          cleanBiography: parsedBio,
          originalCharacteristics: allCharacteristics,
          originalCleanBiography: parsedBio,
          appearances: resolved,
          originalAppearances: resolved,
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
    next.sort(compareByReleaseDateDesc);
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
    setStatusMsg(t.saving_local);

    try {
      const reassembledBiography = buildBiographyHtml(characteristics, cleanBiography);

      const updatedCharacter: CharacterEntry = {
        ...originalCharacter,
        name,
        name_native: normField(nameNative) as string | null | undefined,
        aliases_csv: normField(aliases.join(',')) as string | null | undefined,
        biography: normField(reassembledBiography) as string | null | undefined,
        image_url: normField(imageUrl) as string | null | undefined,
      };

      await saveCharacter(
        currentId, updatedCharacter.name, updatedCharacter.image_url,
        updatedCharacter.name_native, updatedCharacter.aliases_csv, updatedCharacter.biography,
      );
      if (appearancesChanged()) {
        await saveCharacterAppearances(currentId, appearances.map(a => ({
          media_external_id: a.media_external_id,
          relation_type: a.relation_type,
        })));
      }
      if (voiceActorsChanged()) {
        await saveCharacterActors(currentId, voiceActors.map(v => ({
          external_id: v.externalId || `va:${encodeURIComponent(v.name)}`,
          name: v.name,
          name_native: v.native || null,
          image_url: v.image || null,
          role: v.role || 'voice',
          language: v.language || null,
        })));
      }

      setStatusMsg(t.preparing_proposal);

      // Only the fields this session actually edited — same reasoning as
      // minimalProposalCatalogEntry (media proposals): a proposal whose only
      // real change is "added a voice actor" shouldn't also re-propose the
      // name/bio/aliases/image as if the user had touched those too.
      const characterFields: CharacterProposalBundle['character'] = { external_id: updatedCharacter.external_id };
      if (isFieldChanged(name, originalCharacter.name)) characterFields.name = updatedCharacter.name;
      if (isFieldChanged(nameNative, originalCharacter.name_native)) characterFields.name_native = updatedCharacter.name_native;
      if (aliases.join(',') !== (originalCharacter.aliases_csv || '')) characterFields.aliases_csv = updatedCharacter.aliases_csv;
      if (isFieldChanged(cleanBiography, originalCleanBiography)) characterFields.biography = updatedCharacter.biography;
      if (isFieldChanged(imageUrl, originalCharacter.image_url)) characterFields.image_url = updatedCharacter.image_url;

      const bundle: CharacterProposalBundle = {
        character: characterFields,
        appearances: appearances.map(a => ({
          media_external_id: a.media_external_id,
          relation_type: a.relation_type,
        })),
        // AniList-sourced actors (real external_id from the search picker)
        // only propose the relation itself (role/language) — name/native/
        // image are AniList's data, not this proposal's; a legacy row with
        // no real external_id (typed in manually, before the picker existed)
        // has no other way to be identified/displayed, so keeps its fields.
        actors: voiceActors.map(v => v.externalId?.startsWith('person:a') ? {
          external_id: v.externalId,
          role: v.role || 'voice',
          language: v.language || null,
        } : {
          external_id: v.externalId || `va:${encodeURIComponent(v.name)}`,
          name: v.name,
          name_native: v.native || null,
          image_url: v.image || null,
          role: v.role || 'voice',
          language: v.language || null,
        }),
      };

      // Explicit removals from *this* editing session — lets the merge
      // against whatever's upstream tell "the user removed this" apart from
      // "this session never even loaded it" (see mergeListByKey), instead of
      // the submitted appearances/actors list blindly overwriting upstream's.
      const removedAppearanceIds = originalAppearances
        .filter(orig => !appearances.some(a => a.media_external_id === orig.media_external_id))
        .map(orig => orig.media_external_id);
      const removedActorIds = originalVoiceActors
        .filter(orig => orig.externalId && !voiceActors.some(v => v.externalId === orig.externalId))
        .map(orig => orig.externalId as string);

      const changeSummary = `- ${buildChangeSummary()}`;
      const prUrl = await submitCollaborativeProposal(
        currentId,
        [{ kind: 'character', externalId: currentId, bundle, removedAppearanceIds, removedActorIds }],
        changeSummary,
        setStatusMsg,
      );

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

  const removeVoiceActor = (index: number) => {
    setVoiceActors(prev => prev.filter((_, i) => i !== index));
  };

  if (!mounted || !isOpen) return null;

  if (loading) {
    return createPortal(
      <div className="pr-editor-overlay" onClick={handleClose}>
        <div className="pr-editor-modal pr-editor-modal--loading" onClick={e => e.stopPropagation()}>
          <div className="spinner" />
        </div>
      </div>,
      document.body
    );
  }

  if (!character) return null;

  return createPortal(
    <div className="pr-editor-overlay" onClick={handleClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span className="pr-editor-title">{t.title}</span>
            <span className="pr-editor-subtitle">ID: {currentId}</span>
          </div>
          {statusMsg && (
            <div className="pr-editor-header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--accent, #7c6af7)' }}>
              <div className="spinner spinner--small" style={{ width: '14px', height: '14px', border: '2px solid rgba(124, 106, 247, 0.2)', borderTopColor: 'var(--accent, #7c6af7)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span>{statusMsg}</span>
            </div>
          )}
        </div>

        <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {/* ── Fila de Cabecera: Foto + Datos Básicos ── */}
          <div className="pr-editor-section" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <div className="pr-editor-cover-preview-card" style={{ width: '110px', aspectRatio: '3 / 4', flexShrink: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {imageUrl
                  ? <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span className="pr-editor-cover-placeholder">{t.no_image}</span>}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={handleChangePhoto} style={{ fontSize: '0.75rem', width: '100%' }}>
                {t.change_image}
              </button>
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

          {/* ── Características (Edad, Género, Estatura...) ── */}
          <div className="pr-editor-section">
            <span className="pr-editor-section-title">
              {t.characteristics}
              {characteristicsChanged() && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              {characteristics.map((c, idx) => (
                <div key={idx} className="pr-editor-char-row">
                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={c.label}
                    onChange={e => updateCharacteristic(idx, 'label', e.target.value)}
                    placeholder={t.char_label_ph}
                    style={{ flex: '0 0 35%', minWidth: 0, fontWeight: 600 }}
                  />
                  <div className="pr-editor-char-divider" />
                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={c.value}
                    onChange={e => updateCharacteristic(idx, 'value', e.target.value)}
                    placeholder={t.char_value_ph}
                    style={{ flex: '1 1 0%', minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="pr-editor-char-remove"
                    onClick={() => removeCharacteristic(idx)}
                    title="Eliminar característica"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="pr-editor-add-btn" onClick={addCharacteristic} style={{ marginTop: '0.75rem' }}>
              {t.add_characteristic}
            </button>
          </div>

          {/* ── Biografía ── */}
          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
              <Field label={t.biography} changed={isFieldChanged(cleanBiography, originalCleanBiography)} full>
                <textarea
                  ref={bioTextareaRef}
                  value={cleanBiography}
                  onChange={e => {
                    setCleanBiography(e.target.value);
                    adjustBioHeight();
                  }}
                  placeholder={t.biography_ph}
                  style={{
                    minHeight: '120px',
                    height: 'auto',
                    fieldSizing: 'content',
                    resize: 'vertical',
                    overflowY: 'hidden',
                  }}
                />
              </Field>
            </div>
          </div>

          {/* ── Apariciones ── */}
          <div className="pr-editor-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span className="pr-editor-section-title" style={{ margin: 0 }}>
                {t.appearances} ({appearances.length})
                {appearancesChanged() && <span className="pr-editor-section-changed-dot" />}
              </span>
              <button type="button" className="pr-editor-add-btn" onClick={() => setAppearanceSearchOpen(true)}>
                + {t.add_appearance}
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
                  <div className="pr-editor-media-card-title" title={a.title}>{a.title}</div>
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

          {/* ── Actores de Voz (Seiyūs) ── */}
          <div className="pr-editor-section" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span className="pr-editor-section-title" style={{ margin: 0 }}>
                Actores de Voz ({voiceActors.length})
              </span>
              <button type="button" className="pr-editor-add-btn" onClick={() => setVoiceActorSearchOpen(true)}>
                + Añadir actor de voz
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.6rem' }}>
              {voiceActors.map((va, idx) => (
                <div key={idx} className="pr-editor-media-card" style={{ padding: '0.6rem 0.5rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', position: 'relative' }}>
                  <button
                    type="button"
                    className="pr-editor-media-card-remove"
                    onClick={() => removeVoiceActor(idx)}
                    title="Eliminar actor de voz"
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
                      placeholder="Nombre actor"
                      style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.75rem' }}
                    />
                  </div>

                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={va.native}
                    onChange={e => updateVoiceActor(idx, 'native', e.target.value)}
                    placeholder="Nombre nativo (Kanji)"
                    style={{ fontSize: '0.7rem' }}
                  />

                  {/* Selector de Etiquetas de Idioma */}
                  <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                    {['JP', 'ES', 'EN', 'IT', 'DE', 'FR', 'PT', 'KR', 'ZH'].map(langTag => {
                      const LANG_TAG_MAP: Record<string, string> = {
                        'JP': 'Japanese', 'ES': 'Spanish', 'EN': 'English', 'IT': 'Italian',
                        'DE': 'German', 'FR': 'French', 'PT': 'Portuguese', 'KR': 'Korean', 'ZH': 'Chinese',
                      };
                      const curCode = (va.language || 'Japanese').toLowerCase();
                      // No generic curCode.includes(langTag) fallback here —
                      // "Japanese".includes("es") is true, so that check used
                      // to light up the ES tag for every actor still on the
                      // default Japanese language. Only these exact,
                      // unambiguous per-language substrings decide it.
                      const isSelected =
                        (langTag === 'JP' && curCode.includes('japan')) ||
                        (langTag === 'ES' && curCode.includes('span')) ||
                        (langTag === 'EN' && curCode.includes('engl')) ||
                        (langTag === 'IT' && curCode.includes('ital')) ||
                        (langTag === 'DE' && curCode.includes('germ')) ||
                        (langTag === 'FR' && curCode.includes('fren')) ||
                        (langTag === 'PT' && curCode.includes('port')) ||
                        (langTag === 'KR' && curCode.includes('kore')) ||
                        (langTag === 'ZH' && (curCode.includes('chin') || curCode.includes('mand')));

                      return (
                        <button
                          key={langTag}
                          type="button"
                          className={`char-seiyu-lang-btn ${isSelected ? 'char-seiyu-lang-btn--active' : ''}`}
                          onClick={() => updateVoiceActor(idx, 'language', LANG_TAG_MAP[langTag] || langTag)}
                          style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem' }}
                        >
                          {langTag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
    </div>,
    document.body
  );
}
