type StudentNameParts = {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  secondLastName?: string | null | undefined;
};

function clean(value?: string | null): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

export function formatStudentFullName(student: StudentNameParts): string {
  const name = [student.firstName, student.lastName, student.secondLastName]
    .map(clean)
    .filter(Boolean)
    .join(' ');
  return name || 'Alumno sin nombre';
}

export function formatStudentSortName(student: StudentNameParts): string {
  return [student.lastName, student.secondLastName, student.firstName]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('es-CL');
}
