// app/layout.js
export const metadata = {
  title: "NetaWatch — India Political Transparency Tracker",
  description:
    "Track politician wealth, investments, criminal cases, and insider trading patterns. All data sourced from public ECI affidavits.",
  openGraph: {
    title: "NetaWatch",
    description: "India's politician transparency tracker",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#F4F4F4",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
