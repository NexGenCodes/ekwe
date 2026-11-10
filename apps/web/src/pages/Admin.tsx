import { Route, Routes } from "react-router";
import AdminDashboard from "./AdminDashboard";
import UserDetailPage from "./UserDetailPage";

export default function Admin() {
  return (
    <Routes>
      <Route path="users/:userId" element={<UserDetailPage />} />
      <Route path="*" element={<AdminDashboard />} />
    </Routes>
  );
}
