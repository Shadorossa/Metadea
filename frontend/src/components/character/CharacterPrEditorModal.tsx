import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';

interface Props {
  externalId?: string;
  onClose?: () => void;
  onSaved?: () => void;
}

const normField = (v: unknown) => (v === '' || v === undefined ? null : v);

function ChangedDot({ show }: { show: boolean }) {
  return show ? <span className="pr-editor-changed-dot" /> : null;
}

function Field({ label, changed, full, children }: {
  label: string; changed: boolean; full?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`pr-editor-field${full ? ' pr-editor-field--full' : ''}`}>
      <label>
        {label}
        <ChangedDot show={changed} />
      </label>
      {children}
    </div>
  );
}

export function CharacterPrEditorModal({ externalId: initialId, onClose: onCloseProp, onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [currentId, setCurrentId] = useState(initialId || '');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [character, setCharacter] = useState<CharacterEntry | null>(null);
  const [originalCharacter, setOriginalCharacter] = useState<CharacterEntry | null>(null);

  const [name, setName] = useState('');
  const [nameNative, setNameNative] = useState('');
  const [aliases, setAliases] = useState('');
  const [biography, setBiography] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    onCloseProp?.();
  };

  useEffect(() => {
    const handleOpenEditor = (e: CustomEvent) => {
      const id = e.detail?.externalId;
      if (id) {
        setCurrentId(id);
        setIsOpen(true);
        setLoading(true);
      }
    };
    window.addEventListener('open-character-editor', handleOpenEditor as EventListener);

    // Also expose a global function for direct access
    (window as any).openCharacterEditor = (externalId: string) => {
      setCurrentId(externalId);
      setIsOpen(true);
      setLoading(true);
    };

    return () => {
      window.removeEventListener('open-character-editor', handleOpenEditor as EventListener);
      delete (window as any).openCharacterEditor;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !currentId) return;

    const loadCharacter = async () => {
      try {
        const data = await getCharacter(currentId);
        if (!data) {
          setErrorMsg('Personaje no encontrado');
          return;
        }
        setCharacter(data);
        setOriginalCharacter(data);
        setName(data.name || '');
        setNameNative(data.name_native || '');
        setAliases(data.aliases_csv || '');
        setBiography(data.biography || '');
        setImageUrl(data.image_url || '');
      } catch (err) {
        console.error('Failed to load character:', err);
        setErrorMsg('Error al cargar el personaje');
      } finally {
        setLoading(false);
      }
    };
    loadCharacter();
  }, [isOpen, currentId]);

  const hasChanged = () => {
    if (!originalCharacter) return false;
    return (
      name !== (originalCharacter.name || '') ||
      nameNative !== (originalCharacter.name_native || '') ||
      aliases !== (originalCharacter.aliases_csv || '') ||
      biography !== (originalCharacter.biography || '') ||
      imageUrl !== (originalCharacter.image_url || '')
    );
  };

  const buildChangeSummary = () => {
    const changes: string[] = [];
    if (originalCharacter) {
      if (name !== (originalCharacter.name || '')) changes.push(`Nombre: ${name}`);
      if (nameNative !== (originalCharacter.name_native || '')) changes.push(`Nombre nativo: ${nameNative || '(vacío)'}`);
      if (aliases !== (originalCharacter.aliases_csv || '')) changes.push(`Aliases: ${aliases || '(vacío)'}`);
      if (biography !== (originalCharacter.biography || '')) changes.push(`Biografía: ${biography ? 'Actualizada' : '(vacío)'}`);
      if (imageUrl !== (originalCharacter.image_url || '')) changes.push(`Imagen: ${imageUrl || '(vacío)'}`);
    }
    return changes.length > 0 ? changes.join('\n- ') : 'Sin cambios detectados';
  };

  const handleSubmit = async () => {
    if (!originalCharacter || !hasChanged()) {
      setErrorMsg('No hay cambios para enviar');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setStatusMsg('Preparando propuesta...');

    try {
      const updatedCharacter: CharacterEntry = {
        ...originalCharacter,
        name,
        name_native: normField(nameNative) as string | null | undefined,
        aliases_csv: normField(aliases) as string | null | undefined,
        biography: normField(biography) as string | null | undefined,
        image_url: normField(imageUrl) as string | null | undefined,
      };

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
        setStatusMsg('¡Pull Request creado exitosamente!');
        await new Promise(r => setTimeout(r, 1500));
        await openUrlInBrowser(prUrl);
        handleClose();
        onSaved?.();
      }
    } catch (err: any) {
      console.error('Failed to submit proposal:', err);
      setErrorMsg(err.message || 'Error al enviar la propuesta');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !isOpen) return null;

  const container = document.getElementById('character-editor-container');
  if (!container) return null;

  return createPortal(
    <>
      {loading && (
        <div className="pr-editor-loading">
          <p>Cargando personaje...</p>
        </div>
      )}

      {!loading && errorMsg && (
        <div className="pr-editor-error">
          <p>{errorMsg}</p>
        </div>
      )}

      {!loading && character && (
        <div className="pr-editor-content">
          <div className="pr-editor-section">
            <div className="pr-editor-form">
              <Field label="Nombre" changed={name !== (originalCharacter?.name || '')}>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="pr-editor-input"
                />
              </Field>

              <Field label="Nombre Nativo" changed={nameNative !== (originalCharacter?.name_native || '')}>
                <input
                  type="text"
                  value={nameNative}
                  onChange={e => setNameNative(e.target.value)}
                  className="pr-editor-input"
                  placeholder="(Opcional)"
                />
              </Field>

              <Field label="Aliases" changed={aliases !== (originalCharacter?.aliases_csv || '')}>
                <textarea
                  value={aliases}
                  onChange={e => setAliases(e.target.value)}
                  className="pr-editor-textarea pr-editor-textarea--sm"
                  placeholder="Nombres alternativos separados por comas (Opcional)"
                />
              </Field>

              <Field label="Biografía" changed={biography !== (originalCharacter?.biography || '')} full>
                <textarea
                  value={biography}
                  onChange={e => setBiography(e.target.value)}
                  className="pr-editor-textarea"
                  placeholder="Descripción del personaje (Opcional)"
                />
              </Field>

              <Field label="URL de Imagen" changed={imageUrl !== (originalCharacter?.image_url || '')}>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  className="pr-editor-input"
                  placeholder="https://... (Opcional)"
                />
              </Field>

              {imageUrl && (
                <div className="pr-editor-image-preview">
                  <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} />
                </div>
              )}
            </div>
          </div>

          {statusMsg && (
            <div className="pr-editor-status">
              <p>{statusMsg}</p>
            </div>
          )}

          <div className="pr-editor-actions">
            <button
              className="pr-editor-btn pr-editor-btn--secondary"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              className="pr-editor-btn pr-editor-btn--primary"
              onClick={handleSubmit}
              disabled={submitting || !hasChanged()}
            >
              {submitting ? 'Enviando...' : 'Crear Pull Request'}
            </button>
          </div>
        </div>
      )}
    </>,
    container
  );
}
