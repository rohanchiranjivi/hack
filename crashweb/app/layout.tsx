import './globals.css';
import ClientReporterInit from './components/ClientReporterInit';

export const metadata = {
  title: 'Zon — Everyday, upgraded.',
  description: 'Thoughtful finds for everyday living. (CrashWeb Test Site)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <ClientReporterInit />
      </body>
    </html>
  );
}
