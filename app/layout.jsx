import "./globals.css";

export const metadata = {
  title: "Gungi Online",
  description: "Partidas online de Gungi con sincronizacion en tiempo real.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
