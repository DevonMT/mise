import type { ReactNode } from 'react'

/**
 * A labelled field (#837). No text sits inside the input: a placeholder reads
 * as a value already filled in. The label is always visible; the optional
 * hint is the ds pattern (`.ds-hint` shows only while the field has focus).
 * The hint stays outside the label so a screen reader does not say it twice.
 */
export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  className?: string
  /** Spread the given props onto the input, select or textarea. */
  children: (p: { id: string; 'aria-describedby'?: string }) => ReactNode
}) {
  return (
    <div className={className ? `ds-field field-wrap ${className}` : 'ds-field field-wrap'}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && (
        <p className="ds-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}
