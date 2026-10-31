import { useEffect } from "react";

import { requestAgentFromLink } from "./agent-link-request";
import { useStartNewChat } from "./use-start-new-chat";

/** Opens a new chat with the agent a `radius://dev-agent` link named. */
export function useAgentLinks(): void {
  const startNewChat = useStartNewChat();

  useEffect(() => {
    let disposed = false;
    const claim = (): void => {
      void window.radius
        .takeAgentLink()
        .then((agentId) => {
          if (disposed || !agentId) return;
          requestAgentFromLink(agentId);
          startNewChat();
        })
        .catch((error: unknown) => {
          console.error("[agents] Radius could not open the agent link", error);
        });
    };
    claim();
    const unsubscribe = window.radius.onAgentLink(claim);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [startNewChat]);
}
