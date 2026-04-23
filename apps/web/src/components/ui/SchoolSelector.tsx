import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown } from 'lucide-react';

import { api } from '@/lib/api';
import { useSchoolStore } from '@/stores/school.store';

type School = { id: string; name: string; slug: string };

export function SchoolSelector() {
  const [open, setOpen] = useState(false);
  const { selectedSchoolId, setSelectedSchoolId } = useSchoolStore();

  const { data: schools = [] } = useQuery<School[]>({
    queryKey: ['schools'],
    queryFn: () => api.get('/schools'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!selectedSchoolId && schools.length > 0) {
      const cssp = schools.find((s) => s.slug === 'cssp') ?? schools[0]!;
      setSelectedSchoolId(cssp.id);
    }
  }, [schools, selectedSchoolId, setSelectedSchoolId]);

  const current = schools.find((s) => s.id === selectedSchoolId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted transition-colors max-w-[220px]"
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="truncate text-xs font-medium">
          {current?.name ?? 'Seleccionar colegio…'}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-border bg-background shadow-lg py-1 text-sm">
            {schools.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No hay colegios registrados</p>
            ) : (
              schools.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedSchoolId(s.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 hover:bg-muted transition-colors text-xs flex items-center gap-2 ${
                    s.id === selectedSchoolId ? 'font-semibold text-primary' : ''
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  {s.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
