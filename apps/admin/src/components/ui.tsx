import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primario' | 'amarelo' | 'contorno' | 'sutil';
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
  loading?: boolean;
}

const VARIANTES = {
  primario: 'bg-gradient-to-br from-vermelho to-[#b8161c] text-white hover:brightness-115',
  amarelo: 'bg-amarelo text-preto hover:brightness-108',
  contorno: 'border border-borda text-cinza hover:border-cinza-2 hover:text-white',
  sutil: 'bg-carvao text-cinza hover:bg-borda hover:text-white',
} as const;

const TAMANHOS = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3',
} as const;

export function Button({
  variant = 'primario',
  size = 'md',
  full,
  loading,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-all',
        'focus-visible:outline-2 focus-visible:outline-amarelo focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTES[variant],
        TAMANHOS[size],
        full && 'w-full',
        className,
      )}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'w-full rounded-lg border border-borda bg-preto-3 px-4 py-2.5 text-white',
        'placeholder:text-cinza-2 focus:border-amarelo focus:outline-none',
        className,
      )}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-cinza-2">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-vermelho-2">{error}</span>}
    </label>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-borda bg-preto-2 p-5', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="titulo-display text-base">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Interruptor liga/desliga — usado onde um checkbox seria pouco visivel (ex.: ativar/desativar um template). */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-amarelo' : 'bg-borda',
      )}
    >
      <span
        className={cx(
          'inline-block size-4.5 translate-x-1 transform rounded-full bg-preto transition-transform',
          checked && 'translate-x-6',
        )}
      />
    </button>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx(
        'w-full rounded-lg border border-borda bg-preto-3 px-4 py-2.5 text-white',
        'placeholder:text-cinza-2 focus:border-amarelo focus:outline-none',
        className,
      )}
    />
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-cinza">
      <span className="size-7 animate-spin rounded-full border-3 border-borda border-t-amarelo" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

/** Estado sem dados. O icone e decorativo; o texto carrega a informacao. */
export function Vazio({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="text-3xl opacity-60" aria-hidden>
        {icon}
      </span>
      <p className="font-semibold text-cinza">{title}</p>
      {description && <p className="max-w-xs text-sm text-cinza-2">{description}</p>}
    </div>
  );
}
