import { useEffect, useRef, useState, type ReactNode } from "react";

const navigationItems = [
  { label: "Workspace", icon: "scope", current: true },
  { label: "Agents", icon: "nodes" },
  { label: "Artifacts", icon: "stack" },
  { label: "Activity", icon: "pulse" },
];

const Icon = ({ name }: { name: string }): ReactNode => {
  const paths: Record<string, ReactNode> = {
    scope: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
      </>
    ),
    nodes: (
      <>
        <circle cx="6" cy="7" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="15" cy="18" r="2.5" />
        <path d="m8.4 7 7.1-.7M7.5 9l6.2 6.8m3-7.5-1.2 7.2" />
      </>
    ),
    stack: (
      <>
        <path d="m4 8 8-4 8 4-8 4-8-4Z" />
        <path d="m4 12 8 4 8-4m-16 4 8 4 8-4" />
      </>
    ),
    pulse: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

const WorkspaceHeader = (): ReactNode => {
  const [scrolled, setScrolled] = useState(false);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={topSentinelRef}
        className="workspace-top-sentinel"
        aria-hidden="true"
      />
      <header
        className="workspace-header"
        data-scrolled={scrolled ? "true" : "false"}
      >
        <span className="workspace-header-title" data-window-no-drag>
          Workspace
        </span>
        <span className="platform-chip" data-window-no-drag>
          {window.radius.platform}
        </span>
      </header>
    </>
  );
};

export const App = (): ReactNode => (
  <div className="app-shell">
    <a className="skip-link" href="#main-content">
      Skip to workspace
    </a>

    <aside className="sidebar">
      <div className="window-drag-region" aria-hidden="true" />
      <div className="brand-row">
        <span className="radius-mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand-name">Radius</span>
        <span className="build-label">Alpha</span>
      </div>

      <nav aria-label="Workspace">
        <ul className="primary-navigation">
          {navigationItems.map((item) => (
            <li key={item.label}>
              <a
                href={`#${item.label.toLowerCase()}`}
                aria-current={item.current ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="runtime-status">
        <span className="status-light" aria-hidden="true" />
        <div>
          <strong>Local runtime</strong>
          <span>Ready for an agent</span>
        </div>
      </div>
    </aside>

    <div className="workspace">
      <WorkspaceHeader />

      <main id="main-content" className="workspace-content" tabIndex={-1}>
        <header className="workspace-intro">
          <p className="eyebrow">Local workspace</p>
          <h1>Give an agent a safe place to work.</h1>
        </header>

        <section className="empty-state" aria-labelledby="empty-state-title">
          <div className="orbit-graphic" aria-hidden="true">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <span className="orbit-core" />
          </div>
          <p className="section-index">01 / Connect</p>
          <h2 id="empty-state-title">No agent attached yet</h2>
          <p>
            Radius will host the session, permission prompts, local tools, and
            artifacts. The agent keeps its own model and reasoning loop.
          </p>
          <button type="button">Connect an agent</button>
        </section>

        <footer className="workspace-footer">
          <span>Open source · local first</span>
          <span>Protocol v0</span>
        </footer>
      </main>
    </div>
  </div>
);
