export const metadata = {
  title: "Rydde API",
  description: "Rydde cleaning app backend API",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
