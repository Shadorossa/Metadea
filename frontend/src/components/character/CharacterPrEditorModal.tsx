import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getCharacter, saveCharacter, getCharacterAppearances, saveCharacterAppearances,
  type CharacterEntry, type CharacterAppearance,
} from '../../lib/tauri/characters';
import { getCatalogEntry, saveCatalogEntry } from '../../lib/tauri/catalog';
import { fetchAniListCharacterDetail, fetchAniListDetail } from '../../lib/search/providers/anilist';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { openImageCropModal } from '../shared/ImageCropModal';
import { parseCharacterBiography, buildBiographyHtml, type ParsedCharacteristic } from '../../lib/character/biography-parser';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { getT } from '../../i18n/client';
import { normField, ChangedDot, Field } from '../shared/PrEditorField';
import { TagsInput } from '../shared/TagsInput';

const RELATION_TYPE_OPTIONS = ['MAIN', 'SUPPORTING', 'BACKGROUND'];
const getRelationTypeLabels = () => {
  const t = getT();
  return {
    MAIN: t.character.role_main,
    SUPPORTING: t.character.role_supporting,
    BACKGROUND: t.character.role_background,
  };
};

interface AppearanceRow {
  media_external_id: string;
  relation_type: string | null;
  title: string;
  cover: string | null;
}

const appearanceKey = (a: { media_external_id: string; relation_type: string | null }) =>
  `${a.media_external_id}::${a.relation_type ?? ''}`;

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

  // Cache for character data to avoid reloading from API
  const characterCacheRef = useRef<Record<string, CachedCharacterData>>({});

  const [name, setName] = useState('');
  const [nameNative, setNameNative] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasesInput, setAliasesInput] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  // Biography is split into structured "characteristics" (bold-label lines
  // like "Height: 170 cm") and the remaining free-text — see
  // lib/character/biography-parser.ts. Both get reassembled into a single
  // biography string on save, since that's the only column the DB has.
  const [characteristics, setCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [cleanBiography, setCleanBiography] = useState('');
  const [originalCharacteristics, setOriginalCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [originalCleanBiography, setOriginalCleanBiography] = useState('');

  const [appearances, setAppearances] = useState<AppearanceRow[]>([]);
  const [originalAppearances, setOriginalAppearances] = useState<AppearanceRow[]>([]);
  const [appearanceRelationType, setAppearanceRelationType] = useState('SUPPORTING');
  const [appearanceSearchOpen, setAppearanceSearchOpen] = useState(false);

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
        // Check if we have cached data
        const cached = characterCacheRef.current[currentId];
        if (cached) {
          // Use cached data
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

        // Parse external_id to get AniList character ID
        const [, charId] = currentId.split(':');
        const anilistCharId = parseInt(charId, 10);

        // Fetch from AniList for fresh biography (includes appearances list)
        let anilistDetail = null;
        if (anilistCharId) {
          try {
            anilistDetail = await fetchAniListCharacterDetail(anilistCharId);
          } catch (err) {
            console.error('Failed to fetch from AniList:', err);
          }
        }

        // Load from local DB as fallback
        const localData: CharacterEntry = (await getCharacter(currentId)) ?? {
          id: '',
          external_id: currentId,
          name: '',
          created_at: now,
          updated_at: now,
        };

        // Use AniList data if available, otherwise local
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
        setAliases((data.aliases_csv || '').split(',').map(a => a.trim()).filter(a => a));
        setAliasesInput('');
        setImageUrl(data.image_url || '');

        const { characteristics: parsedStats, cleanBiography: parsedBio } = parseCharacterBiography(data.biography);

        // Add structured fields from AniList as characteristics if not already in parsed stats
        const addedLabels = new Set(parsedStats.map(c => c.label.toLowerCase()));
        const allCharacteristics = [...parsedStats];

        if (anilistDetail?.gender && !addedLabels.has('gender') && !addedLabels.has('género')) {
          allCharacteristics.push({ label: 'Gender', value: anilistDetail.gender });
        }
        if (anilistDetail?.age && !addedLabels.has('age') && !addedLabels.has('edad')) {
          allCharacteristics.push({ label: 'Age', value: String(anilistDetail.age) });
        }
        if (anilistDetail?.bloodType && !addedLabels.has('blood type') && !addedLabels.has('bloodtype') && !addedLabels.has('tipo de sangre') && !addedLabels.has('grupo sanguíneo')) {
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

        // Load appearances from local DB
        const rawAppearances = await getCharacterAppearances(currentId).catch(() => [] as CharacterAppearance[]);

        // Batch catalog lookups to minimize requests
        const missingIds = new Set<string>();
        for (const a of rawAppearances) {
          const cached = await getCatalogEntry(a.media_external_id).catch(() => null);
          if (!cached) missingIds.add(a.media_external_id);
        }

        // Fetch AniList details only for missing ones (batched from anilistDetail.media if available)
        const anilistMediaCache: Record<string, { title: string; cover: string | null }> = {};
        if (anilistDetail?.media?.edges) {
          for (const edge of anilistDetail.media.edges) {
            const extId = `${edge.node.type.toLowerCase()}:${edge.node.id}`;
            anilistMediaCache[extId] = {
              title: edge.node.title.userPreferred || `${edge.node.type}:${edge.node.id}`,
              cover: edge.node.coverImage?.large || null,
            };
          }
        }

        const resolved = await Promise.all(rawAppearances.map(async (a): Promise<AppearanceRow> => {
          let entry = await getCatalogEntry(a.media_external_id).catch(() => null);

          // Try cache first, then AniList as fallback
          if (!entry) {
            if (anilistMediaCache[a.media_external_id]) {
              const cached = anilistMediaCache[a.media_external_id];
              entry = {
                id: '',
                external_id: a.media_external_id,
                type: a.media_external_id.split(':')[0].toUpperCase(),
                title_main: cached.title,
                cover_url: cached.cover,
                created_at: now,
                updated_at: now,
              };
              await saveCatalogEntry(entry).catch(() => {});
            } else {
              try {
                const [type, id] = a.media_external_id.split(':');
                const anilistId = parseInt(id, 10);
                if (type && anilistId) {
                  const detail = await fetchAniListDetail(anilistId);
                  if (detail) {
                    entry = {
                      id: '',
                      external_id: a.media_external_id,
                      type: type.toUpperCase(),
                      title_main: detail.title.english || detail.title.romaji || detail.title.native || a.media_external_id,
                      cover_url: detail.coverImage?.large || null,
                      created_at: now,
                      updated_at: now,
                    };
                    await saveCatalogEntry(entry).catch(() => {});
                  }
                }
              } catch (err) {
                console.error(`Failed to fetch AniList detail for ${a.media_external_id}:`, err);
              }
            }
          }

          return {
            media_external_id: a.media_external_id,
            relation_type: a.relation_type ?? null,
            title: entry?.title_main || a.media_external_id,
            cover: entry?.cover_url ?? null,
          };
        }));
        setAppearances(resolved);
        setOriginalAppearances(resolved);

        // Cache the loaded data
        characterCacheRef.current[currentId] = {
          character: data,
          originalCharacter: data,
          name: data.name || '',
          nameNative: data.name_native || '',
          aliases: (data.aliases_csv || '').split(',').map(a => a.trim()).filter(a => a),
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

  const isFieldChanged = (current: string, original: string | null | undefined) =>
    current !== (original || '');

  const characteristicsChanged = () =>
    JSON.stringify(characteristics) !== JSON.stringify(originalCharacteristics);

  const appearancesChanged = () => {
    const a = new Set(appearances.map(appearanceKey));
    const b = new Set(originalAppearances.map(appearanceKey));
    if (a.size !== b.size) return true;
    for (const k of a) if (!b.has(k)) return true;
    return false;
  };

  const hasChanged = () => {
    if (!originalCharacter) return false;
    return (
      isFieldChanged(name, originalCharacter.name) ||
      isFieldChanged(nameNative, originalCharacter.name_native) ||
      aliases.join(',') !== (originalCharacter?.aliases_csv || '') ||
      isFieldChanged(imageUrl, originalCharacter.image_url) ||
      isFieldChanged(cleanBiography, originalCleanBiography) ||
      characteristicsChanged() ||
      appearancesChanged()
    );
  };

  const buildChangeSummary = () => {
    const changes: string[] = [];
    if (originalCharacter) {
      if (isFieldChanged(name, originalCharacter.name)) changes.push(`Nombre: ${name}`);
      if (isFieldChanged(nameNative, originalCharacter.name_native)) changes.push(`Nombre nativo: ${nameNative || '(vacío)'}`);
      if (aliases.join(',') !== (originalCharacter?.aliases_csv || '')) changes.push(`Aliases: ${aliases.length ? aliases.join(', ') : '(vacío)'}`);
      if (isFieldChanged(imageUrl, originalCharacter.image_url)) changes.push(`Imagen: ${imageUrl || '(vacío)'}`);
      if (isFieldChanged(cleanBiography, originalCleanBiography)) changes.push('Biografía: Actualizada');
      if (characteristicsChanged()) changes.push(`Características: ${characteristics.length} campo(s)`);
      if (appearancesChanged()) changes.push(`Apariciones: ${appearances.length} obra(s)`);
    }
    return changes.length > 0 ? changes.join('\n- ') : 'Sin cambios detectados';
  };

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
    setAppearances([...appearances, {
      media_external_id: result.externalId,
      relation_type: appearanceRelationType,
      title: result.titleMain || result.externalId,
      cover: result.coverUrl,
    }]);
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

      // Persist locally first (same pattern as the media PrEditorModal) so
      // the edit sticks for this user immediately, independent of whether
      // the collaborative PR below succeeds.
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

      setStatusMsg(t.preparing_proposal);

      const bundle: ProposalBundle = {
        media_catalog: {} as any, // Characters don't need media_catalog
        media_relations: [],
        characters: [{
          external_id: updatedCharacter.external_id,
          name: updatedCharacter.name,
          image_url: updatedCharacter.image_url,
        }],
        media_authors: [],
        saga_groups: {},
      };

      const changeSummary = `- ${buildChangeSummary()}`;
      const prUrl = await submitCollaborativeProposal(currentId, bundle, changeSummary, setStatusMsg);

      if (prUrl) {
        setStatusMsg(t.pr_success);
        await new Promise(r => setTimeout(r, 1500));
        // Clear cache for this character so next edit loads fresh data
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

          {/* ── Foto ────────────────────────────────────────────────── */}
          <div className="pr-editor-section">
            <span className="pr-editor-section-title">
              {t.photo}
              {isFieldChanged(imageUrl, originalCharacter?.image_url) && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.6rem' }}>
              <div className="pr-editor-cover-preview-card" style={{ width: '90px', aspectRatio: '3 / 4', flexShrink: 0 }}>
                {imageUrl
                  ? <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} />
                  : <span className="pr-editor-cover-placeholder">{t.no_image}</span>}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={handleChangePhoto}>
                {t.change_image}
              </button>
            </div>
          </div>

          {/* ── Datos básicos ───────────────────────────────────────── */}
          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
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

          {/* ── Características (género, edad, altura...) ──────────── */}
          <div className="pr-editor-section">
            <span className="pr-editor-section-title">
              {t.characteristics}
              {characteristicsChanged() && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.6rem' }}>
              {characteristics.map((c, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={c.label}
                    onChange={e => updateCharacteristic(idx, 'label', e.target.value)}
                    placeholder={t.char_label_ph}
                    style={{ flex: '0 0 40%' }}
                  />
                  <input
                    type="text"
                    value={c.value}
                    onChange={e => updateCharacteristic(idx, 'value', e.target.value)}
                    placeholder={t.char_value_ph}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="pr-editor-media-card-remove"
                    style={{ position: 'static' }}
                    onClick={() => removeCharacteristic(idx)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="pr-editor-add-btn" onClick={addCharacteristic}>{t.add_characteristic}</button>
            </div>
          </div>

          {/* ── Biografía ────────────────────────────────────────────── */}
          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
              <Field label={t.biography} changed={isFieldChanged(cleanBiography, originalCleanBiography)} full>
                <textarea rows={6} value={cleanBiography} onChange={e => setCleanBiography(e.target.value)} placeholder={t.biography_ph} />
              </Field>
            </div>
          </div>

          {/* ── Apariciones ──────────────────────────────────────────── */}
          <div className="pr-editor-section">
            <span className="pr-editor-section-title">
              {t.appearances}
              {appearancesChanged() && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div className="pr-editor-media-group-cards pr-editor-media-group-cards--wide" style={{ marginTop: '0.6rem', marginBottom: '0.75rem' }}>
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
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <select
                value={appearanceRelationType}
                onChange={e => setAppearanceRelationType(e.target.value)}
                className="pr-editor-media-card-select"
                style={{ fontSize: '0.7rem' }}
              >
                {RELATION_TYPE_OPTIONS.map(type => (
                  <option key={type} value={type}>{getRelationTypeLabels()[type as keyof ReturnType<typeof getRelationTypeLabels>] || type}</option>
                ))}
              </select>
              <button type="button" className="pr-editor-add-btn" onClick={() => setAppearanceSearchOpen(true)}>{t.add_appearance}</button>
            </div>
          </div>
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={handleClose} disabled={submitting}>
            {t.cancel}
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting || !hasChanges()}>
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
    </div>,
    document.body
  );
}
