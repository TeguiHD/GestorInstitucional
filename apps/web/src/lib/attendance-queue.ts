const QUEUE_KEY = 'cssp:attendance-queue';

export type QueuedAttendance = {
  id: string; // uuid-ish: courseId_date_timestamp
  courseId: string;
  date: string;
  entries: { studentId: string; status: string; note?: string }[];
  queuedAt: number;
};

function read(): QueuedAttendance[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedAttendance[];
  } catch {
    return [];
  }
}

function write(items: QueuedAttendance[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export const attendanceQueue = {
  enqueue(item: Omit<QueuedAttendance, 'id' | 'queuedAt'>): QueuedAttendance {
    const queued: QueuedAttendance = {
      ...item,
      id: `${item.courseId}_${item.date}_${Date.now()}`,
      queuedAt: Date.now(),
    };
    // Replace any existing entry for same course+date (idempotent)
    const existing = read().filter((q) => !(q.courseId === item.courseId && q.date === item.date));
    write([...existing, queued]);
    return queued;
  },

  remove(id: string) {
    write(read().filter((q) => q.id !== id));
  },

  getAll(): QueuedAttendance[] {
    return read();
  },

  count(): number {
    return read().length;
  },
};
