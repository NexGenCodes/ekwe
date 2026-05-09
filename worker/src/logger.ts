export const logger = {
  info: (data: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), ...data }));
  },
  error: (data: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), ...data }));
  },
  warn: (data: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), ...data }));
  }
};
