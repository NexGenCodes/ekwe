// Registers @testing-library/react-native's built-in Jest matchers and the
// automatic per-test cleanup that ships with the library.
import "@testing-library/react-native";
import { NativeModules } from "react-native";

// op-sqlite (used by src/services/db.ts) needs its JSI native module present
// at import time. Provide a stub that satisfies the install() check and fails
// loudly if a test actually touches the database without mocking it.
if (NativeModules.OPSQLite == null) {
  NativeModules.OPSQLite = {
    install: () => true,
  };
}

global.__OPSQLiteProxy = {
  init: () => {},
  openSync: () => {
    throw new Error(
      "op-sqlite openSync is not mocked in tests. Mock @/services/db or @op-engineering/op-sqlite in your test.",
    );
  },
};
