import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Splash from "./pages/Splash.jsx";
import ProfileSelect from "./pages/ProfileSelect.jsx";
import Shell from "./components/Shell.jsx";
import ThemePicker from "./components/ThemePicker.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Jobs from "./pages/Jobs.jsx";
import JobDetail from "./pages/JobDetail.jsx";
import Tracker from "./pages/Tracker.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import Connectors from "./pages/Connectors.jsx";
import Settings from "./pages/Settings.jsx";
import { useTheme } from "./lib/theme.js";

export default function App() {
  const [booted, setBooted] = useState(false);
  const [profile, setProfile] = useState(null); // {id, name}
  const [theme, setTheme] = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (booted && !profile) navigate("/profiles", { replace: true });
  }, [booted]); // eslint-disable-line

  const selectProfile = (p) => {
    setProfile(p);
    navigate("/dashboard", { replace: true });
  };

  const switchProfile = () => {
    setProfile(null);
    navigate("/profiles", { replace: true });
  };

  if (!booted) {
    return (
      <AnimatePresence>
        <Splash onDone={() => setBooted(true)} theme={theme} />
      </AnimatePresence>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="/profiles"
          element={<ProfileSelect onSelect={selectProfile} theme={theme} />}
        />
        {profile ? (
          <Route
            element={<Shell profile={profile} theme={theme} onSwitchProfile={switchProfile} />}
          >
            <Route path="/dashboard" element={<Dashboard profile={profile} />} />
            <Route path="/jobs" element={<Jobs profile={profile} />} />
            <Route path="/jobs/:jid" element={<JobDetail profile={profile} />} />
            <Route path="/tracker" element={<Tracker profile={profile} />} />
            <Route path="/profile" element={<ProfilePage profile={profile} />} />
            <Route path="/connectors" element={<Connectors profile={profile} />} />
            <Route path="/settings" element={<Settings profile={profile} />} />
          </Route>
        ) : null}
        <Route path="*" element={<Navigate to={profile ? "/dashboard" : "/profiles"} replace />} />
      </Routes>

      {/* available on every screen, including profile select */}
      <ThemePicker theme={theme} setTheme={setTheme} />
    </>
  );
}
