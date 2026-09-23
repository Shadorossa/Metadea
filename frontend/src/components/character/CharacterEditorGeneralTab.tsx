import React, { useState } from 'react';
import { getT } from '../../i18n/runtime';
import { Field } from '../shared/PrEditorField';
import { PrEditorAddButton } from '../media/pr-editor/PrEditorAddButton';
import { TagsInput } from '../shared/TagsInput';
import { RichTextEditor } from '../shared/RichTextEditor';
import { getDroppedImageUrl, openImageCropModal } from '../shared/ImageCropModal';
import { isFieldChanged, characteristicsChanged } from '../../lib/character/character-editor-diff';
import type { CharacterDraft, CharacterEditorAction } from '../../lib/character/character-editor-state';

interface CharacterEditorGeneralTabProps {
  baseline: CharacterDraft;
  draft: CharacterDraft;
  dispatch: React.Dispatch<CharacterEditorAction>;
  setErrorMsg: (message: string) => void;
}

export function CharacterEditorGeneralTab({ baseline, draft, dispatch, setErrorMsg }: CharacterEditorGeneralTabProps) {
  const t = getT().character_editor;
  const [isPhotoDragOver, setIsPhotoDragOver] = useState(false);
  const { name, nameNative, aliases, imageUrl, characteristics, cleanBiography } = draft;
  const originalCharacter = baseline.character;

  const setImageUrl = (value: string) => dispatch({ type: 'edit', patch: { imageUrl: value } });
  const addCharacteristic = () => dispatch({ type: 'edit', patch: { characteristics: [...characteristics, { label: '', value: '' }] } });
  const removeCharacteristic = (idx: number) => dispatch({ type: 'edit', patch: { characteristics: characteristics.filter((_, i) => i !== idx) } });
  const updateCharacteristic = (idx: number, field: 'label' | 'value', value: string) =>
    dispatch({ type: 'edit', patch: { characteristics: characteristics.map((c, i) => i === idx ? { ...c, [field]: value } : c) } });

  const handleChangePhoto = async () => {
    const result = await openImageCropModal({
      title: t.photo_title,
      initialUrl: imageUrl,
      aspectRatio: 3 / 4,
      saveLabel: t.photo_save,
      outputMimeType: 'image/webp',
    });
    if (result.action === 'saved') setImageUrl(result.imageUrl);
  };

  const handlePhotoDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsPhotoDragOver(false);
    const droppedUrl = getDroppedImageUrl(event.dataTransfer);
    if (droppedUrl) {
      setImageUrl(droppedUrl);
      setErrorMsg('');
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
    {/* Cabecera: Foto + Datos Básicos */}
    <div className="pr-editor-section" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1.5rem', alignItems: 'start', marginBottom: '2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          className={`pr-editor-char-photo-wrap${isPhotoDragOver ? ' is-dragging' : ''}`}
          onClick={handleChangePhoto}
          onDragOver={event => { event.preventDefault(); setIsPhotoDragOver(true); }}
          onDragLeave={() => setIsPhotoDragOver(false)}
          onDrop={handlePhotoDrop}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleChangePhoto(); } }}
          title={t.change_image}
        >
          {imageUrl
            ? <img src={imageUrl} alt={name} onError={() => setErrorMsg(t.invalid_image_url)} />
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
          <input type="text" value={name} onChange={e => dispatch({ type: 'edit', patch: { name: e.target.value } })} />
        </Field>

        <Field label={t.native_name} changed={isFieldChanged(nameNative, originalCharacter?.name_native)}>
          <input type="text" value={nameNative} onChange={e => dispatch({ type: 'edit', patch: { nameNative: e.target.value } })} placeholder={t.optional} />
        </Field>

        <Field label={t.aliases} changed={aliases.join(',') !== (originalCharacter?.aliases_csv || '')} full>
          <TagsInput tags={aliases} onChange={next => dispatch({ type: 'edit', patch: { aliases: next } })} placeholder={t.aliases_ph} />
        </Field>
      </div>
    </div>

    {/* Características */}
    <div className="pr-editor-section" style={{ marginBottom: '2rem' }}>
      <span className="pr-editor-section-title">
        {t.characteristics}
        {characteristicsChanged(characteristics, baseline.characteristics) && <span className="pr-editor-section-changed-dot" />}
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
      <PrEditorAddButton onClick={addCharacteristic} title={t.add_characteristic} className="pr-editor-character-add-btn" />
    </div>

    {/* ── Biografía ── */}
    <div className="pr-editor-section">
      <div className="pr-editor-form-grid">
        <Field label={t.biography} changed={isFieldChanged(cleanBiography, baseline.cleanBiography)} full>
          <RichTextEditor
            value={cleanBiography}
            onChange={value => dispatch({ type: 'edit', patch: { cleanBiography: value } })}
            placeholder={t.biography_ph}
          />
        </Field>
      </div>
    </div>
    </>
  );
}
