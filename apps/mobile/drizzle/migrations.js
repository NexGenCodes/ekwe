import journal from "./meta/_journal.json";
import m0000 from "./0000_romantic_trish_tilby.sql";
import m0001 from "./0001_optimized_indexes.sql";
import m0002 from "./0002_history_origin.sql";
import m0003 from "./0003_tan_talisman.sql";
import m0004 from "./0004_history_deleted_at.sql";
import m0005 from "./0005_milky_talon.sql";

export default {
  journal,
  migrations: { m0000, m0001, m0002, m0003, m0004, m0005 },
};
