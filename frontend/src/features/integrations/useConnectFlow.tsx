import { useState } from "react";
import type { Integration } from "@/api/platform";
import { AdvancedSetupDrawer, OAuthConnectDrawer, TelegramSetupDrawer } from "@/features/integrations/ConnectFlows";

export function useConnectFlow() {
  const [target, setTarget] = useState<Integration | null>(null);
  const [advanced, setAdvanced] = useState<Integration | null>(null);
  const open = (i: Integration) => setTarget(i);
  const drawers = (
    <>
      {target && target.key === "telegram" && (
        <TelegramSetupDrawer integration={target} open onClose={() => setTarget(null)} />
      )}
      {target && target.key !== "telegram" && (
        <OAuthConnectDrawer
          integration={target}
          open
          onClose={() => setTarget(null)}
          onAdvanced={() => {
            setAdvanced(target);
            setTarget(null);
          }}
        />
      )}
      {advanced && <AdvancedSetupDrawer integration={advanced} open onClose={() => setAdvanced(null)} />}
    </>
  );
  return { open, openAdvanced: setAdvanced, drawers };
}
