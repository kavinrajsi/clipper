"use client"

// The last resort: this catches errors thrown by the root layout itself, which
// no route-group error.js can reach. Because it replaces the root layout, it
// must render its own <html> and <body> — and it therefore gets none of the
// app's providers, fonts, or theme.
//
// So this is written with inline styles and no imports on purpose. Anything it
// pulled in could be the very thing that failed.
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Clipper didn&apos;t start
          </h1>
          <p style={{ marginTop: "0.5rem", lineHeight: 1.6, color: "#555" }}>
            Something failed before the page could render. Reloading usually
            clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#fff",
              background: "#111",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error?.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#777",
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
