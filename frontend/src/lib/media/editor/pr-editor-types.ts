// Types shared between PrEditorModal and its extracted helpers. Living here
// (not in the component) is what lets pr-editor-*.ts and usePrEditorSession
// import them without a cycle back into the 1,900-line modal.
import type { ProposalFileEntry } from '../../github/submit-collaborative-proposal';

// Always saved as a PART_OF relation — there's no per-item type to pick
// anymore (previously episode/update, shown as a dropdown).
export interface BundledRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

// Editable relations: ADAPTATION, SPIN_OFF, ALTERNATIVE, etc (not saga-managed)
export interface EditableRelation {
  related_media_external_id: string;
  relation_type: string;
  type_label: string;
  title?: string | null;
  cover?: string | null;
}

export interface PreparedMediaProposal {
  entries: ProposalFileEntry[];
  changeSummary: string;
}

export interface PrEditorSessionHandle {
  hasChanges: () => boolean;
  affectedExternalIds: () => string[];
  prepareProposal: () => Promise<PreparedMediaProposal | null>;
}

export interface PrEditorSessionTab {
  externalId: string;
  label: string;
  dirty: boolean;
  affected: boolean;
  kind?: 'media' | 'character';
}
