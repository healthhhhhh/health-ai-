import { Activity, Droplet, Flame, Footprints, Heart, Moon, Scale } from "lucide-react";
import type { MetricKind } from "@healthmate/shared-types";
import type { ReactNode } from "react";

export const METRIC_ICON: Record<MetricKind, ReactNode> = {
  heart_rate: <Heart fill="currentColor" />,
  steps: <Footprints />,
  sleep: <Moon fill="currentColor" />,
  calories: <Flame fill="currentColor" />,
  water: <Droplet />,
  weight: <Scale />,
  blood_pressure: <Activity />,
};
