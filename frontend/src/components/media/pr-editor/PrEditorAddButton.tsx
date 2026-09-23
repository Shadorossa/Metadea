import { getT } from '../../../i18n/runtime';

interface Props {
  onClick: () => void;
  className?: string;
  title?: string;
}

export function PrEditorAddButton({ onClick, className = '', title }: Props) {
  return (
    <button type="button" className={`pr-editor-add-btn ${className}`.trim()} onClick={onClick} title={title}>
      {getT().pr_editor.add}
    </button>
  );
}
