interface Props {
  onClick: () => void;
  className?: string;
}

export function PrEditorAddButton({ onClick, className = '' }: Props) {
  return (
    <button type="button" className={`pr-editor-add-btn ${className}`.trim()} onClick={onClick}>
      + Añadir
    </button>
  );
}
