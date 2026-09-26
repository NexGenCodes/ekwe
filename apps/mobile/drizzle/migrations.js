import journal from "./meta/_journal.json";
import m0000 from "./0000_romantic_trish_tilby.sql";
import m0001 from "./0001_optimized_indexes.sql";
import m0002 from "./0002_history_origin.sql";

export default { journal, migrations: { m0000, m0001, m0002 } };