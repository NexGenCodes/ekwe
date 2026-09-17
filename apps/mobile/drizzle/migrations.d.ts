interface MigrationJournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

interface LocalMigrations {
  journal: { entries: MigrationJournalEntry[] };
  migrations: Record<string, string>;
}

declare const migrations: LocalMigrations;
export default migrations;
