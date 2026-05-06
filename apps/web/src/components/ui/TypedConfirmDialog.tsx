import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';

type TypedConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmWord?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
};

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmWord = 'ELIMINAR',
  confirmLabel = 'Confirmar eliminación',
  onConfirm,
  loading = false,
  destructive = true,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  const handleOpenChange = (value: boolean) => {
    if (!value) setTyped('');
    onOpenChange(value);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 space-y-3 text-sm text-muted-foreground">
              <div>{description}</div>
              <label className="block space-y-1.5">
                <span>
                  Escribe <strong className="font-mono text-foreground">{confirmWord}</strong>:
                </span>
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={confirmWord}
                  autoComplete="off"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                setTyped('');
                onConfirm();
              }}
              disabled={typed !== confirmWord || loading}
              className={
                destructive
                  ? 'rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50'
                  : 'rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50'
              }
            >
              {loading ? 'Procesando...' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
