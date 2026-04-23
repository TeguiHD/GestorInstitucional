import { AlertCircle } from 'lucide-react';

type Props = {
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ message = 'Ocurrió un error al cargar los datos.', onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 py-12 px-8 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-destructive mb-3" strokeWidth={1.5} />
      <p className="text-sm font-medium text-destructive">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-muted transition-colors"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
