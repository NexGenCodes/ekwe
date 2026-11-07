import { Route, Routes } from "react-router";
import { Suspense, lazy } from "react";
import Landing from "./pages/Landing";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Changelog from "./pages/Changelog";

const Admin = lazy(() => import("./pages/Admin"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/changelog" element={<Changelog />} />
      <Route
        path="/admin/*"
        element={
          <Suspense
            fallback={
              <div className="container" style={{ paddingTop: 140 }}>
                Loading admin…
              </div>
            }
          >
            <Admin />
          </Suspense>
        }
      />
    </Routes>
  );
}
