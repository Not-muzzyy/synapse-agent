import { Mutex } from 'async-mutex';

const globalForMutex = global as unknown as { studySessionMutex: Mutex };
export const studySessionMutex = globalForMutex.studySessionMutex || new Mutex();
if (process.env.NODE_ENV !== 'production') globalForMutex.studySessionMutex = studySessionMutex;
