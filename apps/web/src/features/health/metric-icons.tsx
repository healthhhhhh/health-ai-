import type { MeasurementKind } from "@healthmate/shared-types";
import { Activity, Footprints, HeartPulse, Moon, Scale, Zap } from "lucide-react";
import type { ReactNode } from "react";

export const MEASUREMENT_ICON: Partial<Record<MeasurementKind, ReactNode>> = {
  steps: <Footprints />,
  heart_rate: <HeartPulse />,
  resting_heart_rate: <Activity />,
  sleep: <Moon />,
  active_energy: <Zap />,
  weight: <Scale />,
};
