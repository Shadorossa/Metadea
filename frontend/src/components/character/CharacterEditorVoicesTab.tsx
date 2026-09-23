import React from 'react';
import { getT } from '../../i18n/runtime';
import { PrEditorAddButton } from '../media/pr-editor/PrEditorAddButton';
import { VoiceActorLangStepper } from './VoiceActorLangStepper';
import { correlateVoiceActor } from '../../lib/character/voice-actor-resolver';
import type { VoiceActorRow } from '../../lib/character/character-editor-diff';
import type { CharacterEditorAction } from '../../lib/character/character-editor-state';

interface CharacterEditorVoicesTabProps {
  voiceActors: VoiceActorRow[];
  dispatch: React.Dispatch<CharacterEditorAction>;
  onOpenSearch: () => void;
}

export function CharacterEditorVoicesTab({ voiceActors, dispatch, onOpenSearch }: CharacterEditorVoicesTabProps) {
  const t = getT().character_editor;

  const updateVoiceActor = (index: number, field: keyof VoiceActorRow, value: string) => {
    dispatch({ type: 'edit', patch: prev => ({ voiceActors: prev.voiceActors.map((va, i) => i === index ? { ...va, [field]: value } : va) }) });
  };

  const handleVoiceActorBlur = async (index: number, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const current = voiceActors[index];
    if (current && (!current.externalId || current.externalId.startsWith('va:'))) {
      const match = await correlateVoiceActor(clean, current.language);
      if (match.matchedFrom !== 'none') {
        dispatch({ type: 'edit', patch: prev => ({ voiceActors: prev.voiceActors.map((va, i) => {
          if (i !== index) return va;
          return {
            ...va,
            externalId: match.externalId,
            name: match.name,
            native: match.native || va.native,
            image: match.image || va.image,
          };
        }) }) });
      }
    }
  };

  const removeVoiceActor = (index: number) => {
    dispatch({ type: 'edit', patch: prev => ({ voiceActors: prev.voiceActors.filter((_, i) => i !== index) }) });
  };

  return (
    <>
    <div className="pr-editor-section">
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
      <div className="pr-editor-add-row">
        <PrEditorAddButton onClick={onOpenSearch} title={t.add_voice_actor} />
      </div>
    </div>
    </>
  );
}
