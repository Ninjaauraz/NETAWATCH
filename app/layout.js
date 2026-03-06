// app/layout.js
export const metadata = {
  title: "NetaWatch — India Political Transparency",
  description: "Track politician wealth, criminal cases, and conflict of interest. All data from public ECI affidavits.",
  openGraph: {
    title: "NetaWatch",
    description: "India's politician transparency tracker",
    type: "website",
  },
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#fafaf8" />
      </head>
      <body style={{
        margin: 0, padding: 0,
        background: "#fafaf8",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}>
        {children}
      </body>
    </html>
  );
}
