interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
  title?: string;
}

export function Switch({ on, onChange, title }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      className={`switch${on ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    />
  );
}
