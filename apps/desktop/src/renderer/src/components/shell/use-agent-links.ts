import { useEffect } from "react";

import { requestAgentFromLink } from "./agent-link-request";
import { useStartNewChat } from "./use-start-new-chat";

// Main hands a link out once. If the effect that claimed it was cleaned up
// before the answer arrived (StrictMode remounts, or a new startNewChat), the
// next effect still has to open the chat.
let chatAwaitingLink = false;

/** Opens a new chat with the agent a `radius://dev-agent` link named. */
export function useAgentLinks(): void {
  const startNewChat = useStartNewChat();

  useEffect(() => {
    let disposed = false;
    const openChat = (): void => {
      if (disposed || !chatAwaitingLink) return;
      chatAwaitingLink = false;
      startNewChat();
    };
    const claim = (): void => {
      void window.radius
        .takeAgentLink()
        .then((agentId) => {
          if (!agentId) return;
          requestAgentFromLink(agentId);
          chatAwaitingLink = true;
          openChat();
        })
        .catch((error: unknown) => {
          console.error("[agents] Radius could not open the agent link", error);
        });
    };
    openChat();
    claim();
    const unsubscribe = window.radius.onAgentLink(claim);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [startNewChat]);
}
