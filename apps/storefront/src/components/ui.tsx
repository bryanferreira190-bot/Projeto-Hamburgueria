import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/** Junta classes ignorando valores falsos. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------------- Botao ---------------- */

type ButtonVariant = 'primario' | 'amarelo' | 'contorno' | 'fantasma';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primario:
    'bg-gradient-to-br from-vermelho to-[#b8161c] text-white shadow-[0_12px_34px_rgba(224,31,38,.35)] hover:from-amarelo hover:to-[#f2a900] hover:text-preto',
  amarelo: 'bg-amarelo text-preto hover:bg-amarelo-2',
  contorno: 'border-2 border-amarelo text-amarelo hover:bg-amarelo hover:text-preto',
  fantasma: 'bg-white/6 text-white border border-white/20 hover:bg-white hover:text-preto',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  loading?: boolean;
}

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
        'inline-flex items-center justify-center gap-2 rounded-full font-bold tracking-wide',
        'transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0',
        'focus-visible:outline-3 focus-visible:outline-amarelo focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
    >
      {loading && (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

/* ---------------- Campos ---------------- */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">
        {label}
        {required && <span className="text-vermelho-2"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-cinza-2">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-vermelho-2">{error}</span>}
    </label>
  );
}

const CAMPO_BASE =
  'w-full rounded-xl bg-preto-3 border border-borda px-4 py-3 text-white placeholder:text-cinza-2 ' +
  'transition-colors focus:border-amarelo focus:outline-none';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CAMPO_BASE, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(CAMPO_BASE, 'resize-none', className)} />;
}

/* ---------------- Diversos ---------------- */

export function Badge({
  children,
  tone = 'neutro',
}: {
  children: ReactNode;
  tone?: 'neutro' | 'sucesso' | 'alerta' | 'perigo';
}) {
  const tones = {
    neutro: 'bg-carvao text-cinza border-borda',
    sucesso: 'bg-verde/12 text-verde border-verde/40',
    alerta: 'bg-amarelo/12 text-amarelo border-amarelo/40',
    perigo: 'bg-vermelho/12 text-vermelho-2 border-vermelho/40',
  } as const;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-cinza">
      <span className="size-8 animate-spin rounded-full border-3 border-borda border-t-amarelo" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="text-5xl" aria-hidden>
        {icon}
      </span>
      <h3 className="titulo-display text-xl">{title}</h3>
      {description && <p className="max-w-sm text-sm text-cinza">{description}</p>}
      {action}
    </div>
  );
}
