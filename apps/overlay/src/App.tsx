export function App() {
  return (
    <main className="overlay-root">
      <section className="connection-state" aria-live="polite">
        <span className="connection-indicator" aria-hidden="true" />
        <div>
          <h1>Live Board Overlay</h1>
          <p>ローカル接続を待機しています</p>
        </div>
      </section>
    </main>
  );
}
