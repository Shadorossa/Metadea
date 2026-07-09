import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';

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

export function CharacterPrEditorModal() {
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
    setCharacter(null);
    setOriginalCharacter(null);
    setErrorMsg('');
    setStatusMsg('');
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
        const now = new Date().toISOString();
        const data: CharacterEntry = (await getCharacter(currentId)) ?? {
          id: '',
          external_id: currentId,
          name: '',
          created_at: now,
          updated_at: now,
        };
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
  }, [isOpen, currentId, loadNonce]);

  const isFieldChanged = (current: string, original: string | null | undefined) =>
    current !== (original || '');

  const hasChanged = () => {
    if (!originalCharacter) return false;
    return (
      isFieldChanged(name, originalCharacter.name) ||
      isFieldChanged(nameNative, originalCharacter.name_native) ||
      isFieldChanged(aliases, originalCharacter.aliases_csv) ||
      isFieldChanged(biography, originalCharacter.biography) ||
      isFieldChanged(imageUrl, originalCharacter.image_url)
    );
  };

  const buildChangeSummary = () => {
    const changes: string[] = [];
    if (originalCharacter) {
      if (isFieldChanged(name, originalCharacter.name)) changes.push(`Nombre: ${name}`);
      if (isFieldChanged(nameNative, originalCharacter.name_native)) changes.push(`Nombre nativo: ${nameNative || '(vacío)'}`);
      if (isFieldChanged(aliases, originalCharacter.aliases_csv)) changes.push(`Aliases: ${aliases || '(vacío)'}`);
      if (isFieldChanged(biography, originalCharacter.biography)) changes.push(`Biografía: ${biography ? 'Actualizada' : '(vacío)'}`);
      if (isFieldChanged(imageUrl, originalCharacter.image_url)) changes.push(`Imagen: ${imageUrl || '(vacío)'}`);
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
        media_catalog: {} as any,
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
      }
    } catch (err: any) {
      console.error('Failed to submit proposal:', err);
      setErrorMsg(err.message || 'Error al enviar la propuesta');
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
            <span className="pr-editor-title">Editar Personaje</span>
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

          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
              <Field label="Nombre" changed={isFieldChanged(name, originalCharacter?.name)}>
                <input type="text" value={name} onChange={e => setName(e.target.value)} />
              </Field>

              <Field label="Nombre Nativo" changed={isFieldChanged(nameNative, originalCharacter?.name_native)}>
                <input type="text" value={nameNative} onChange={e => setNameNative(e.target.value)} placeholder="(Opcional)" />
              </Field>

              <Field label="Aliases" changed={isFieldChanged(aliases, originalCharacter?.aliases_csv)}>
                <input type="text" value={aliases} onChange={e => setAliases(e.target.value)} placeholder="Nombres alternativos separados por comas (Opcional)" />
              </Field>

              <Field label="URL de Imagen" changed={isFieldChanged(imageUrl, originalCharacter?.image_url)}>
                <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://... (Opcional)" />
              </Field>

              <Field label="Biografía" changed={isFieldChanged(biography, originalCharacter?.biography)} full>
                <textarea rows={6} value={biography} onChange={e => setBiography(e.target.value)} placeholder="Descripción del personaje (Opcional)" />
              </Field>

              {imageUrl && (
                <div className="pr-editor-cover-preview-card pr-editor-field--full" style={{ maxWidth: '160px' }}>
                  <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={handleClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting || !hasChanged()}>
            {submitting ? 'Enviando...' : 'Crear Pull Request'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
