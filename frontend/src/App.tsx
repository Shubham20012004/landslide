import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EmptyState, Loading } from "./components/ui";

const Overview = lazy(() => import("./pages/Overview"));
const LiveMonitoring = lazy(() => import("./pages/LiveMonitoring"));
const SensorAnalytics = lazy(() => import("./pages/SensorAnalytics"));
const Historical = lazy(() => import("./pages/HistoricalIntelligence"));
const Datasets = lazy(() => import("./pages/DatasetManagement"));
const Training = lazy(() => import("./pages/ModelTraining"));
const Evaluation = lazy(() => import("./pages/ModelEvaluation"));
const Predictions = lazy(() => import("./pages/Predictions"));
const Alerts = lazy(() => import("./pages/AlertsEvents"));
const Devices = lazy(() => import("./pages/DeviceHealth"));
const Settings = lazy(() => import("./pages/Settings"));
const SystemInfo = lazy(() => import("./pages/SystemInfo"));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/live" element={<LiveMonitoring />} />
          <Route path="/analytics" element={<SensorAnalytics />} />
          <Route path="/historical" element={<Historical />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/training" element={<Training />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/predictions" element={<Predictions />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/system" element={<SystemInfo />} />
          <Route path="*" element={<EmptyState title="Page not found" action={<Link className="text-sky-400" to="/">Back to overview</Link>} />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
