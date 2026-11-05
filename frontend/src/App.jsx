import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Machines from "./pages/Machines.jsx";
import Analyse from "./pages/Analyse.jsx";
import Ideal from "./pages/Ideal.jsx";
import History from "./pages/History.jsx";
import Batch from "./pages/Batch.jsx";
import Reports from "./pages/Reports.jsx";
import ModelInfo from "./pages/ModelInfo.jsx";

function Protected({ children }) {
  const { auth } = useAuth();
  return auth ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/analyse" element={<Analyse />} />
        <Route path="/batch" element={<Batch />} />
        <Route path="/ideal" element={<Ideal />} />
        <Route path="/history" element={<History />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/model" element={<ModelInfo />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
