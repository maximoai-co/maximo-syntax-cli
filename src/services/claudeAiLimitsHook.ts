import { useEffect, useState } from "react";
import {
  type MaximoAILimits,
  currentLimits,
  statusListeners,
} from "./claudeAiLimits.js";

export function useMaximoAiLimits(): MaximoAILimits {
  const [limits, setLimits] = useState<MaximoAILimits>({ ...currentLimits });

  useEffect(() => {
    const listener = (newLimits: MaximoAILimits) => {
      setLimits({ ...newLimits });
    };
    statusListeners.add(listener);

    return () => {
      statusListeners.delete(listener);
    };
  }, []);

  return limits;
}
