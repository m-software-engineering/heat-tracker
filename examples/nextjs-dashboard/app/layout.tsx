import "./globals.css";

export const metadata = {
  title: "Heat Tracker Dashboard",
  description: "Reference heatmap dashboard example"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
