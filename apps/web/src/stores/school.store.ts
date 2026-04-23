import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useUser } from './auth.store';

type SchoolState = {
  selectedSchoolId: string | null;
  setSelectedSchoolId: (id: string) => void;
};

export const useSchoolStore = create<SchoolState>()(
  persist(
    (set) => ({
      selectedSchoolId: null,
      setSelectedSchoolId: (id) => set({ selectedSchoolId: id }),
    }),
    { name: 'school-selector' },
  ),
);

export function useEffectiveSchoolId(): string {
  const user = useUser();
  const selectedSchoolId = useSchoolStore((s) => s.selectedSchoolId);
  return user?.schoolId || selectedSchoolId || '';
}
